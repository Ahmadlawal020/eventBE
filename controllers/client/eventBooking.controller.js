const {notifyPaymentCompletion}=require("../../services/paymentCompletionNotifications.service");
const { recordBookingReferral } = require("../../services/referral.service");
const EventBooking = require("../../models/client/eventBooking.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const Ticket = require("../../models/client/eventTicketType.schema");
const Event = require("../../models/client/event.schema");
const User = require("../../models/client/user.schema");
const {
  dispatchNotification,
  NOTIFICATION_TYPES,
  emailTemplates,
  notifyTicketPurchased,
} = require("../../services/notification");
const { getPaymentGateway } = require("../../services/payment");
const { createTicketsForBooking } = require("./userEventTicket.controller");
const crypto = require("crypto");
const { getEffectiveEventSettings: getEventSettings } = require("../../services/eventSettings.service");
const {
  calculateTicketPricing,
  getPlatformFees,
} = require("../../services/ticketFees.service");

const gateway = getPaymentGateway();
const { currencyForCheckout, reserveEventBooking, completePayment } = require("../../services/checkoutSafety.service");

/**
 * PRICE QUOTE
 * Read-only and safe for signed-out event browsing. Checkout repeats this
 * calculation after authenticating and never trusts totals sent by the app.
 */
const quoteBooking = async (req, res) => {
  const { eventId, items } = req.body;
  try {
    if (!eventId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Select at least one ticket to get a price quote.",
      });
    }
    if (typeof eventId !== "string" || !/^[a-f0-9]{24}$/i.test(eventId))
      return res.status(400).json({ success: false, message: "Invalid event ID." });
    const validation = require("../../services/eventOrderValidation.service");
    validation.validateEventOrderItems(items, 1000);
    const event = await Event.findOne({ _id: eventId, status: "LISTED" }).lean();
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const settings = await getEventSettings(event.managementLocation);
    const quantityRequested = validation.validateEventOrderItems(items, settings.ticketing.maxTicketsPerOrder);
    require("../../services/eventEntry.service").assertEntryOpen(event);
    await require("../../services/eventCapacity.service").assertEventCapacity(event, quantityRequested);
    let quoteCurrency = null;
    const pricedInputs = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!item.product || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Each ticket must have a valid quantity.",
        });
      }
      const ticket = await Ticket.findById(item.product).lean();
      if (!ticket || String(ticket.eventId) !== String(eventId)) {
        return res.status(400).json({
          success: false,
          message: "One of the selected tickets is not available for this event.",
        });
      }
      validation.assertTierOrderLimit(ticket, quantity);
      const now = Date.now();
      if ((ticket.salesStartAt && new Date(ticket.salesStartAt).getTime() > now) ||
          (ticket.salesEndAt && new Date(ticket.salesEndAt).getTime() <= now))
        return res.status(409).json({ success: false, message: "Ticket sales are closed." });
      if (quantity > Math.max(0, ticket.totalQuantity - ticket.soldQuantity)) {
        return res.status(400).json({
          success: false,
          message: `Only ${Math.max(0, ticket.totalQuantity - ticket.soldQuantity)} ${ticket.name} tickets remain.`,
        });
      }
      let pricePerUnit = ticket.ticketType === "PAID"
        ? Number(ticket.price?.amountCents || 0)
        : ticket.ticketType === "DONATION"
          ? Number(item.pricePerUnit || 0)
          : 0;
      if (
        ticket.ticketType === "DONATION" &&
        (pricePerUnit < Number(ticket.donationRange?.minCents || 0) ||
          pricePerUnit > Number(ticket.donationRange?.maxCents || 0))
      ) {
        return res.status(400).json({
          success: false,
          message: `Donation for ${ticket.name} is outside the allowed range.`,
        });
      }
      if (!Number.isSafeInteger(pricePerUnit) || pricePerUnit < 0 || !Number.isSafeInteger(pricePerUnit * quantity))
        return res.status(400).json({ success: false, message: "Invalid ticket amount." });
      const currency = currencyForCheckout(ticket.currency?.code);
      if(quoteCurrency && quoteCurrency!==currency)return res.status(400).json({success:false,message:"Ticket currencies do not match"});
      quoteCurrency=currency;
      pricedInputs.push({
        ticketId: ticket._id,
        name: ticket.name,
        quantity,
        pricePerUnit,
        subtotalAmount: pricePerUnit * quantity,
        commissionType: ticket.commission?.type,
      });
    }

    const pricing = calculateTicketPricing({
      items: pricedInputs,
      fees: await getPlatformFees(),
      currency: { code: quoteCurrency, symbol: "₦" },
    });
    return res.json({ success: true, data: { pricing } });
  } catch (error) {
    console.error("[TICKET QUOTE ERROR]", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Could not calculate this ticket order.",
    });
  }
};

/**
 * CREATE BOOKING
 */
const createBooking = async (req, res) => {
  const { eventId, items, paymentMethod, totalAmount } = req.body;
  const buyerId = req.user.id; // From verifyJWT middleware
  let checkoutCurrency = null;
  let attempt;
  try {
    const attempts = require("../../services/eventCheckoutAttempt.service");
    attempt = attempts.identity(req.body);
    const existing = await attempts.findAttempt(buyerId, attempt);
    if (existing) return await attempts.respond(existing._id, res);
    // 1. Fetch User details for automated filling
    const user = await User.findById(buyerId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const fullName = `${user.firstName} ${user.surname}`.trim();
    const phoneNumber = user.phoneNumber || "Not Provided";
    const email = user.email;

    // 2. Validate Event
    const event = await Event.findById(eventId);
    if (!event) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    if (event.status !== "LISTED") return res.status(409).json({ success: false, message: "This event is not accepting new bookings." });

    // 2. Validate Tickets and Inventory
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one ticket item is required.",
      });
    }

    const settings = await getEventSettings(event.managementLocation);
    const requestedQuantity = items.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0,
    );
    if (requestedQuantity > settings.ticketing.maxTicketsPerOrder) {
      return res.status(400).json({
        success: false,
        message: `A single order can contain at most ${settings.ticketing.maxTicketsPerOrder} tickets`,
      });
    }

    if (!["CARD", "FREE"].includes(paymentMethod)) return res.status(400).json({success:false,message:"Invalid payment method"});
    require("../../services/eventOrderValidation.service").validateEventOrderItems(items, settings.ticketing.maxTicketsPerOrder);
    const quotedTicketVersions = [];
    const processedItems = [];
    for (const item of items) {
      if (!item.product || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Each item must have a valid product and quantity >= 1.",
        });
      }

      const ticketType = await Ticket.findById(item.product);
      if (!ticketType) {
        return res.status(404).json({
          success: false,
          message: `Ticket type ${item.product} not found`,
        });
      }

      if (ticketType.eventId.toString() !== eventId.toString()) {
        return res.status(400).json({
          success: false,
          message: `Ticket type ${item.product} does not belong to this event`,
        });
      }

      require("../../services/eventOrderValidation.service").assertTierOrderLimit(ticketType, item.quantity);
      quotedTicketVersions.push({ ticketId: String(ticketType._id), updatedAt: ticketType.updatedAt });
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

      const itemCurrency = currencyForCheckout(ticketType.currency?.code);
      if (checkoutCurrency && checkoutCurrency !== itemCurrency) return res.status(400).json({success:false,message:"All tickets in an order must use the same currency"});
      checkoutCurrency = itemCurrency;

      let pricePerUnit = 0;
      if (ticketType.ticketType === "FREE") {
        pricePerUnit = 0;
      } else if (ticketType.ticketType === "DONATION") {
        // Use the price provided by the user
        pricePerUnit = Number(item.pricePerUnit || 0);

        // Validate donation range
        if (ticketType.donationRange) {
          if (
            pricePerUnit < ticketType.donationRange.minCents ||
            pricePerUnit > ticketType.donationRange.maxCents
          ) {
            return res.status(400).json({
              success: false,
              message: `Donation for ${ticketType.name} must be between ${ticketType.currency.symbol}${ticketType.donationRange.minCents / 100} and ${ticketType.currency.symbol}${ticketType.donationRange.maxCents / 100}`,
            });
          }
        }
      } else {
        // PAID ticket
        pricePerUnit = ticketType.price?.amountCents || 0;
      }

      if (!Number.isSafeInteger(pricePerUnit) || pricePerUnit < 0) return res.status(400).json({success:false,message:"Invalid ticket amount"});
      const itemTotal = pricePerUnit * item.quantity;

      processedItems.push({
        ticketId: ticketType._id,
        name: ticketType.name,
        quantity: item.quantity,
        pricePerUnit: pricePerUnit,
        totalPrice: itemTotal,
        subtotalAmount: itemTotal,
        commissionType: ticketType.commission?.type,
      });
    }

    const pricing = calculateTicketPricing({
      items: processedItems,
      fees: await getPlatformFees(),
      currency: {
        code: checkoutCurrency,
        symbol: processedItems.length ? "â‚¦" : "â‚¦",
      },
    });
    const pricedItems = pricing.items.map((pricedItem, index) => ({
      ...processedItems[index],
      subtotalAmount: pricedItem.subtotalAmount,
      feeMode: pricedItem.feeMode,
      feeAmount: pricedItem.feeAmount,
      buyerFeeAmount: pricedItem.buyerFeeAmount,
      organiserFeeAmount: pricedItem.organiserFeeAmount,
    }));
    const bookingPricing = {
      subtotalAmount: pricing.subtotalAmount,
      platformFeeAmount: pricing.platformFeeAmount,
      buyerFeeAmount: pricing.buyerFeeAmount,
      organiserFeeAmount: pricing.organiserFeeAmount,
      organiserPayoutAmount: pricing.organiserPayoutAmount,
      feePercentage: pricing.percentage,
      feeMode: pricing.mode,
      fixedFeeAmount: pricing.fixedFeeAmount,
    };

    // 3. Prepare Reference
    const reference = `MNB_ORD_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

    if (paymentMethod === "FREE" && pricing.totalAmount > 0) return res.status(400).json({success:false,message:"This booking requires payment"});
    const organiser = paymentMethod === "CARD" && pricing.totalAmount > 0
      ? await User.findById(event.createdBy).select("vendorAccountCode") : null;
    if(paymentMethod === "CARD" && pricing.totalAmount > 0 && !organiser?.vendorAccountCode)return res.status(409).json({success:false,message:"The organiser must connect a payout account before accepting online payments."});
    const savedBooking = await reserveEventBooking({
      ...attempt, checkoutPricing: pricing, checkoutSubaccount: organiser?.vendorAccountCode,
      quotedTicketVersions, eventId, buyer:buyerId, guestDetails:{fullName,phoneNumber,email},
      items:pricedItems, ...bookingPricing, totalAmount:pricing.totalAmount,
      currency:checkoutCurrency, paymentMethod, paymentReference:reference,
      paymentStatus:pricing.totalAmount === 0 ? "COMPLETED" : "PENDING",
    });

    return await require("../../services/eventCheckoutAttempt.service").respond(savedBooking._id, res);
  } catch (error) {
    if (error.code === 11000 && attempt) {
      try {
        const existing = await require("../../services/eventCheckoutAttempt.service").findAttempt(buyerId, attempt);
        if (existing) return await require("../../services/eventCheckoutAttempt.service").respond(existing._id, res);
      } catch (retryError) { error = retryError; }
    }
    // Reservations and booking creation roll back together on transaction failure.
    // After persistence, gateway uncertainty is reconciled by the expiry job.
    console.error("[CREATE BOOKING ERROR]", error);
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.statusCode ? error.message : "Server error during checkout", terminal: error.terminal || false, paymentReference: error.paymentReference });
  }
};

/**
 * VERIFY BOOKING
 */
const getBookingPaymentStatus = async (req, res) => {
  try {
    const booking = await EventBooking.findOne({ paymentReference: req.params.reference, buyer: req.user.id })
      .select("paymentStatus paymentMethod totalAmount status paymentReference paymentResolutionRequired").lean();
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
    return res.json({ success: true, data: { booking } });
  } catch { return res.status(500).json({ success: false, message: "Could not read booking status." }); }
};
const verifyBooking = async (req, res) => {
  try {
    const existing = await EventBooking.findOne({ paymentReference: req.params.reference, buyer: req.user.id });
    if (!existing) return res.status(404).json({ success: false, message: "Booking not found." });
    if (existing.status === "CANCELLED" || existing.paymentResolutionRequired)
      return res.status(409).json({ success: false, message: "This booking is closed or requires payment review.", data: { booking: existing } });
    if (existing.paymentStatus === "COMPLETED") {
      const tickets = await UserEventTicket.find({ bookingId: existing._id, owner: req.user.id }).lean();
      return res.json({ success: true, message: "Tickets are ready.", data: { booking: existing, tickets } });
    }
    if (existing.totalAmount === 0 || existing.paymentMethod === "FREE")
      return res.status(409).json({ success: false, message: "This free booking does not require payment verification." });
    const payment = await gateway.verifyPayment(req.params.reference);
    const result = await completePayment(req.params.reference, payment, {buyerId:req.user.id,kind:"EVENT_TICKET"});
    if (result.conflict) return res.status(409).json({success:false,message:"Payment received for a cancelled or expired booking. Please contact the organiser.",data:{booking:result.booking}});
    await recordBookingReferral(result.booking._id,"EVENT_TICKET");
    await notifyPaymentCompletion(result);
    const tickets = await UserEventTicket.find({bookingId:result.booking._id, owner: req.user.id}).lean();
    return res.json({success:true,message:"Payment verified and tickets generated",data:{booking:result.booking,tickets}});
  } catch(error) {
    return res.status(error.statusCode || 502).json({success:false,message:error.statusCode ? error.message : "Could not verify payment. Please try again."});
  }
};

const getMyBookings = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const filter = { buyer: req.user.id, ...(req.query.needsAttention === "true" ? { paymentResolutionRequired: true } : {}) };

    const [bookings, total] = await Promise.all([
      EventBooking.find(filter)
        .select("eventId items totalAmount currency paymentMethod paymentStatus paymentReference status paymentResolutionRequired createdAt")
        .populate("eventId", "title status images location schedule")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      EventBooking.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: bookings,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[GET MY BOOKINGS ERROR]", err);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching bookings" });
  }
};

module.exports = {
  getBookingPaymentStatus,
  quoteBooking,
  createBooking,
  verifyBooking,
  getMyBookings,
};
