const EventBooking = require("../../models/user/eventBooking.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");
const Ticket = require("../../models/user/eventTicket.schema");
const Event = require("../../models/user/event.schema");
const User = require("../../models/user/user.schema");
const { initializeTransaction, verifyTransaction } = require("../../services/paystack.service");
const { createTicketsForBooking } = require("./userEventTicket.controller");
const paystackService = require("../../services/paystack.service"); // For type consistency if used elsewhere
const crypto = require("crypto");


/**
 * CREATE BOOKING
 */
const createBooking = async (req, res) => {
  const { eventId, items, paymentMethod, totalAmount } = req.body;
  const buyerId = req.user.id; // From verifyJWT middleware

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
    const processedItems = [];
    let calculatedTotal = 0;

    for (const item of items) {
      const ticketType = await Ticket.findById(item.product);
      if (!ticketType) {
        return res.status(404).json({ success: false, message: `Ticket type ${item.product} not found` });
      }

      const available = ticketType.totalQuantity - ticketType.soldQuantity;
      if (available < item.quantity) {
        return res.status(400).json({ success: false, message: `Not enough tickets available for ${ticketType.name}` });
      }

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

    // Only save immediately if NOT Paystack or if it's FREE
    if (paymentMethod !== "PAYSTACK" || calculatedTotal === 0) {
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
        paystackReference: reference,
        paymentStatus: calculatedTotal === 0 ? "COMPLETED" : "PENDING",
      });
      savedBooking = await newBooking.save();
    }

    // 4. Handle Payment Flow
    if (paymentMethod === "PAYSTACK" && calculatedTotal > 0) {
      // Initialize Paystack with full booking details in metadata
      const paystackData = await initializeTransaction({
        email: email,
        amount: calculatedTotal / 100, // Service expects Naira
        reference: reference,
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
          booking: savedBooking, // will be null for Paystack
          payment: paystackData,
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
    // 1. Verify with Paystack first to get metadata if needed
    const transaction = await verifyTransaction(reference);

    if (transaction.status === "success") {
      let booking = await EventBooking.findOne({ paystackReference: reference });

      // If booking already exists and is completed, return success early to avoid duplicate generation/increments
      if (booking && booking.paymentStatus === "COMPLETED") {
        return res.json({
          success: true,
          message: "Payment already verified and tickets generated.",
          data: { booking }
        });
      }

      // 2. If booking doesn't exist, create it from metadata
      if (!booking) {
        let metadata = transaction.metadata;
        
        // Paystack sometimes returns metadata as a string
        if (typeof metadata === "string" && metadata.trim() !== "") {
          try {
            metadata = JSON.parse(metadata);
          } catch (e) {
            console.error("[METADATA PARSE ERROR]", e);
          }
        }

        const { eventId, buyerId, items, totalAmount, fullName, phoneNumber } = metadata || {};

        if (!eventId || !buyerId || !items) {
           return res.status(400).json({ 
             success: false, 
             message: "Booking details missing in payment metadata. Please contact support." 
           });
        }
        
        booking = new EventBooking({
          eventId,
          buyer: buyerId,
          guestDetails: {
            fullName,
            phoneNumber,
            email: transaction.customer.email,
          },
          items,
          totalAmount,
          paymentMethod: "PAYSTACK",
          paystackReference: reference,
          paymentStatus: "COMPLETED",
        });
        await booking.save();
      } else {
        // If it exists but is pending, mark as completed
        if (booking.paymentStatus !== "COMPLETED") {
          booking.paymentStatus = "COMPLETED";
          await booking.save();
        }
      }

      // 3. Generate Individual Tickets
      const tickets = await createTicketsForBooking(booking);

      return res.json({
        success: true,
        message: "Payment verified and tickets generated",
        data: {
          booking,
          tickets
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: `Payment status: ${transaction.status}`,
        data: transaction,
      });
    }

  } catch (error) {
    console.error("[VERIFY BOOKING ERROR]", error);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
};

const getMyBookings = async (req, res) => {
  try {
    const bookings = await EventBooking.find({ buyer: req.user.id })
      .populate("eventId", "title images location startDate")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: bookings });
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
