const EventBooking = require("../../models/user/eventBooking.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");
const Ticket = require("../../models/user/eventTicketType.schema");
const Event = require("../../models/user/event.schema");
const User = require("../../models/user/user.schema");
const { getPaymentGateway } = require("../../services/payment");
const { createTicketsForBooking } = require("./userEventTicket.controller");
const crypto = require("crypto");

const gateway = getPaymentGateway();


/**
 * CREATE BOOKING
 */
const createBooking = async (req, res) => {
  const { eventId, items, paymentMethod, totalAmount } = req.body;
  const buyerId = req.user.id; // From verifyJWT middleware
  let reservedTickets = []; // Track atomic reservations for rollback

  try {
    // 1. Fetch User details for automated filling
    const user = await User.findById(buyerId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const fullName = `${user.firstName} ${user.surname}`.trim();
    const phoneNumber = user.phoneNumber || "Not Provided";
    const email = user.email;

    // 2. Validate Event
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // 2. Validate Tickets and Inventory
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one ticket item is required." });
    }

    const processedItems = [];
    let calculatedTotal = 0;

    for (const item of items) {
      if (!item.product || !item.quantity || item.quantity < 1) {
        return res.status(400).json({ success: false, message: "Each item must have a valid product and quantity >= 1." });
      }

      const ticketType = await Ticket.findById(item.product);
      if (!ticketType) {
        return res.status(404).json({ success: false, message: `Ticket type ${item.product} not found` });
      }

      if (ticketType.eventId.toString() !== eventId.toString()) {
        return res.status(400).json({
          success: false,
          message: `Ticket type ${item.product} does not belong to this event`,
        });
      }

      // Validate Sales Window
      const now = new Date();
      if (ticketType.salesStartAt && now < new Date(ticketType.salesStartAt)) {
        return res.status(400).json({
          success: false,
          message: `Ticket "${ticketType.name}" is not on sale yet.`,
        });
      }
      if (ticketType.salesEndAt && now > new Date(ticketType.salesEndAt)) {
        return res.status(400).json({
          success: false,
          message: `Ticket sales for "${ticketType.name}" have ended.`,
        });
      }

      // Atomic inventory reservation: check + increment in one operation
      const reservation = await Ticket.findOneAndUpdate(
        {
          _id: item.product,
          $expr: { $gte: [{ $subtract: ["$totalQuantity", "$soldQuantity"] }, item.quantity] },
        },
        { $inc: { soldQuantity: item.quantity } },
        { new: true },
      );

      if (!reservation) {
        // Rollback previous reservations
        for (const prev of reservedTickets) {
          await Ticket.findByIdAndUpdate(prev.ticketId, { $inc: { soldQuantity: -prev.quantity } });
        }
        return res.status(400).json({ success: false, message: `Not enough tickets available for ${ticketType.name}` });
      }
      reservedTickets.push({ ticketId: item.product, quantity: item.quantity });

      let pricePerUnit = 0;
      if (ticketType.ticketType === "FREE") {
        pricePerUnit = 0;
      } else if (ticketType.ticketType === "DONATION") {
        // Use the price provided by the user
        pricePerUnit = Number(item.pricePerUnit || 0);
        
        // Validate donation range
        if (ticketType.donationRange) {
          if (pricePerUnit < ticketType.donationRange.minCents || 
              pricePerUnit > ticketType.donationRange.maxCents) {
            return res.status(400).json({ 
              success: false, 
              message: `Donation for ${ticketType.name} must be between ${ticketType.currency.symbol}${ticketType.donationRange.minCents/100} and ${ticketType.currency.symbol}${ticketType.donationRange.maxCents/100}` 
            });
          }
        }
      } else {
        // PAID ticket
        pricePerUnit = ticketType.price?.amountCents || 0;
      }

      const itemTotal = pricePerUnit * item.quantity;
      calculatedTotal += itemTotal;

      processedItems.push({
        ticketId: ticketType._id,
        name: ticketType.name,
        quantity: item.quantity,
        pricePerUnit: pricePerUnit,
        totalPrice: itemTotal,
      });
    }

    // 3. Prepare Reference
    const reference = `MNB_ORD_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

    let savedBooking = null;

    // Only save immediately if NOT card payment or if it's FREE
    if (paymentMethod !== "CARD" || calculatedTotal === 0) {
      const newBooking = new EventBooking({
        eventId,
        buyer: buyerId,
        guestDetails: {
          fullName,
          phoneNumber,
          email,
        },
        items: processedItems,
        totalAmount: calculatedTotal,
        paymentMethod,
        paymentReference: reference,
        paymentStatus: calculatedTotal === 0 ? "COMPLETED" : "PENDING",
      });
      savedBooking = await newBooking.save();
    }

    // 4. Handle Payment Flow
    if (paymentMethod === "CARD" && calculatedTotal > 0) {
      // Get the event owner's subaccount details
      const organiser = await User.findById(event.createdBy).select("vendorAccountCode");

      // Initialize payment with full booking details in metadata
      const paymentData = await gateway.initializePayment({
        email: email,
        amount: calculatedTotal / 100, // Service expects main currency unit
        reference: reference,
        subaccount: organiser?.vendorAccountCode || undefined,
        metadata: {
          eventId,
          buyerId,
          items: processedItems.map(item => ({
            ticketId: item.ticketId.toString(),
            name: item.name,
            quantity: item.quantity,
            pricePerUnit: item.pricePerUnit,
            totalPrice: item.totalPrice,
          })),
          totalAmount: calculatedTotal,
          fullName,
          phoneNumber,
          type: "EVENT_TICKET",
        },
      });

      return res.json({
        success: true,
        data: {
          booking: savedBooking, // will be null for card payment
          payment: paymentData,
        },
      });
    }

    // If Free booking, generate tickets immediately
    if (savedBooking && savedBooking.paymentStatus === "COMPLETED") {
      const tickets = await createTicketsForBooking(savedBooking);
      return res.json({
        success: true,
        message: "Booking successful and tickets generated",
        data: { booking: savedBooking, tickets },
      });
    }

    // If PENDING (e.g., Bank Transfer or other manual methods)
    res.json({
      success: true,
      message: "Order initiated successfully. Awaiting payment confirmation.",
      data: { booking: savedBooking },
    });

  } catch (error) {
    // Rollback any atomic reservations on unexpected error
    for (const prev of reservedTickets) {
      try {
        await Ticket.findByIdAndUpdate(prev.ticketId, { $inc: { soldQuantity: -prev.quantity } });
      } catch (_) {}
    }
    console.error("[CREATE BOOKING ERROR]", error);
    res.status(500).json({ success: false, message: "Server error during checkout" });
  }
};

/**
 * VERIFY BOOKING
 */
const verifyBooking = async (req, res) => {
  const { reference } = req.params;

  try {
    // 1. Verify with payment gateway
    let transaction;
    try {
      transaction = await gateway.verifyPayment(reference);
    } catch (gatewayError) {
      console.error(`[VERIFY BOOKING] Gateway verification failed for ref ${reference}:`, gatewayError.message);
      return res.status(502).json({
        success: false,
        message: "Could not verify payment with payment provider. Please try again.",
      });
    }

    if (transaction.status !== "success") {
      return res.status(400).json({
        success: false,
        message: `Payment status: ${transaction.status}`,
      });
    }

    // 2. Find or create booking
    let booking = await EventBooking.findOne({ paymentReference: reference });

    // Idempotent: already completed
    if (booking && booking.paymentStatus === "COMPLETED") {
      return res.json({
        success: true,
        message: "Payment already verified and tickets generated.",
        data: { booking }
      });
    }

    // Create booking from Paystack metadata (for CARD payments that didn't save a booking upfront)
    if (!booking) {
      let metadata = transaction.metadata;

      if (typeof metadata === "string" && metadata.trim() !== "") {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          console.error(`[VERIFY BOOKING] Failed to parse metadata for ref ${reference}:`, e);
          return res.status(400).json({
            success: false,
            message: "Payment metadata is corrupted. Please contact support.",
          });
        }
      }

      const { eventId, buyerId, items, totalAmount, fullName, phoneNumber } = metadata || {};

      if (!eventId || !buyerId || !items) {
        console.error(`[VERIFY BOOKING] Missing metadata fields for ref ${reference}. Metadata:`, JSON.stringify(metadata));
        return res.status(400).json({
          success: false,
          message: "Booking details missing in payment metadata. Please contact support.",
        });
      }

      try {
        booking = new EventBooking({
          eventId,
          buyer: buyerId,
          guestDetails: {
            fullName,
            phoneNumber,
            email: transaction.customer?.email,
          },
          items,
          totalAmount,
          paymentMethod: "CARD",
          paymentReference: reference,
          paymentStatus: "COMPLETED",
        });
        await booking.save();
      } catch (saveError) {
        // Handle duplicate key race condition (webhook or parallel verify)
        if (saveError.code === 11000) {
          console.log(`[VERIFY BOOKING] Duplicate booking for ref ${reference}, fetching existing`);
          booking = await EventBooking.findOne({ paymentReference: reference });
          if (booking && booking.paymentStatus !== "COMPLETED") {
            booking.paymentStatus = "COMPLETED";
            await booking.save();
          }
        } else {
          console.error(`[VERIFY BOOKING] Failed to save booking for ref ${reference}:`, saveError);
          return res.status(500).json({
            success: false,
            message: "Failed to create booking record. Please try again.",
          });
        }
      }
    } else {
      // Existing pending booking — mark as completed
      booking.paymentStatus = "COMPLETED";
      await booking.save();
    }

    // 3. Generate Individual Tickets (idempotent — skip if tickets already exist)
    let tickets;
    try {
      const existingTickets = await UserEventTicket.find({ bookingId: booking._id }).lean();
      if (existingTickets.length > 0) {
        tickets = existingTickets;
      } else {
        tickets = await createTicketsForBooking(booking);
      }
    } catch (ticketError) {
      console.error(`[VERIFY BOOKING] Ticket generation failed for ref ${reference}:`, ticketError);
      // Booking is saved as COMPLETED, so the webhook or retry can generate tickets
      return res.json({
        success: true,
        message: "Payment verified. Tickets are being generated — please check your tickets shortly.",
        data: { booking, tickets: [] },
      });
    }

    return res.json({
      success: true,
      message: "Payment verified and tickets generated",
      data: {
        booking,
        tickets
      },
    });

  } catch (error) {
    console.error(`[VERIFY BOOKING] Unexpected error for ref ${req.params.reference}:`, error);
    res.status(500).json({ success: false, message: "Verification failed. Please try again." });
  }
};

const getMyBookings = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      EventBooking.find({ buyer: req.user.id })
        .populate("eventId", "title images location startDate")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      EventBooking.countDocuments({ buyer: req.user.id }),
    ]);

    res.json({
      success: true,
      data: bookings,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[GET MY BOOKINGS ERROR]", err);
    res.status(500).json({ success: false, message: "Server error fetching bookings" });
  }
};

module.exports = {
  createBooking,
  verifyBooking,
  getMyBookings
};
