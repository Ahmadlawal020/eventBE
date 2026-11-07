const {notifyPaymentCompletion}=require("../../services/paymentCompletionNotifications.service");
const { recordBookingReferral } = require("../../services/referral.service");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const User = require("../../models/client/user.schema");
const { dispatchNotification, NOTIFICATION_TYPES, emailTemplates } = require("../../services/notification");
const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/client/staffInvitation.schema");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { getPaymentGateway } = require("../../services/payment");
const { generateTicketNumber, generateQRPayload, verifyQRPayload } = require("../../utils/qr");
const { hasSlotConflict } = require("../../utils/slotConflict");
const { logBookingHistory } = require("./bookingHistory.controller");
const {
  calculateEventCenterPricing,
  getPlatformFees,
} = require("../../services/ticketFees.service");
const {
  getEventCenterSettings,
} = require("../../services/eventCenterSettings.service");

const gateway = getPaymentGateway();
const { venueQuote, completePayment } = require("../../services/checkoutSafety.service");

/**
 * Check if a user is authorized to scan/verify tickets for an event center.
 * Owner: always has access
 * Co-organiser: SCAN_TICKET or ALL_ACCESS
 * Staff: SCAN_TICKET
 */
async function authorizeScanAccess(userId, eventCenterId) {
  const eventCenter = await EventCenter.findById(eventCenterId).select("createdBy").lean();
  if (!eventCenter) return { authorized: false, error: "Event center not found." };

  if (String(eventCenter.createdBy) === userId) return { authorized: true };

  const coOrganiserInvite = await CoOrganiserInvitation.findOne({
    coOrganiser: userId,
    host: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: { $in: ["SCAN_TICKET", "ALL_ACCESS"] },
  }).lean();
  if (coOrganiserInvite) return { authorized: true };

  const staffInvite = await StaffInvitation.findOne({
    staff: userId,
    organiser: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: { $in: ["SCAN_TICKET", "ALL_ACCESS"] },
  }).lean();
  if (staffInvite) return { authorized: true };

  return { authorized: false, error: "Not authorized to scan tickets for this venue." };
}

// ===================== CREATE TICKET (PENDING) =====================
const createTicket = async (req, res) => {
  const { eventCenterId, selectedDates, bookingUnit, duration, totalPrice } =
    req.body;
  const buyerId = req.user.id;
  if (req.body.paymentMethod && req.body.paymentMethod !== "paystack") return res.status(400).json({ success: false, message: "Use secure online checkout. Offline bookings must be recorded by the organiser." });

  try {
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

    // 2. Fetch Event Center details to verify owner and prevent request body tampering
    const eventCenter = await EventCenter.findById(eventCenterId);
    if (!eventCenter) {
      return res
        .status(404)
        .json({ success: false, message: "Event Center not found." });
    }

    if (eventCenter.status !== "LISTED") return res.status(409).json({ success: false, message: "This event center is not accepting new bookings." });

    // Match this exact reservation, including hourly slots, before quoting occupied dates.
    const normalizedDates = (selectedDates || []).map(d => ({ date: new Date(d.date),
      ...(bookingUnit === "hour" ? { startTime: d.startTime, endTime: d.endTime === "00:00" ? "24:00" : d.endTime } : {}) }));
    if (normalizedDates.length && normalizedDates.every(d => !isNaN(+d.date))) {
      const existingPending = await EventCenterBooking.findOne({ buyer: buyerId, eventCenter: eventCenterId,
        paymentStatus: { $in: ["PENDING", "COMPLETED"] }, status: { $in: ["ACTIVE", "PENDING_REVIEW", "CONFIRMED"] }, bookingUnit,
        selectedDates: { $size: normalizedDates.length, $all: normalizedDates.map(d => ({ $elemMatch: d })) },
      }).sort({ createdAt: -1 });
      if (existingPending) {
        const result = await require("../../services/venueCheckoutAttempt.service").resumeVenueCheckout(existingPending._id, gateway);
        return res.status(result.data.checkoutPending ? 202 : 201).json(result);
      }
    }

    // 2a. Validate against platform venue settings
    const platformSettings = await getEventCenterSettings();
    if (eventCenter.bookingSettings === "INSTANT" && !platformSettings.booking.instantBookingEnabled) {
      return res.status(400).json({ success: false, message: "Instant booking is currently disabled on the platform." });
    }
    if (eventCenter.bookingSettings === "REVIEW" && !platformSettings.booking.reviewBookingEnabled) {
      return res.status(400).json({ success: false, message: "Host review booking is currently disabled on the platform." });
    }

    const quote = venueQuote(eventCenter, req.body);
    if (selectedDates && selectedDates.length > 0) {
      const maxMonths = platformSettings.booking?.maximumBookingWindowMonths || 12;
      const maximumBookingDate = platformSettings.booking?.maximumBookingDate;
      const horizon = maximumBookingDate || require("../../services/venueBookingRules.service").lastBookableDay(require("../../services/bookingAttendance.service").dayOf(new Date()), maxMonths);
      const horizonDate = new Date(`${horizon}T23:59:59.999Z`);

      const exceedsWindow = selectedDates.some((d) => {
        const target = new Date(d.date || d);
        return !isNaN(target.getTime()) && target > horizonDate;
      });

      if (exceedsWindow) {
        return res.status(400).json({
          success: false,
          message: maximumBookingDate
            ? `Bookings cannot be made after ${maximumBookingDate}.`
            : `Bookings cannot be made more than ${maxMonths} months in advance.`,
        });
      }
    }

    // venueQuote enforces shared occupancy, expired-hold, timing and preparation rules.

    const pricing = calculateEventCenterPricing({
      subtotalAmount:quote.subtotalAmount, currency:quote.currency,
      fees:await getPlatformFees(), feeMode:eventCenter.basePrice?.feeMode,
      feeCollectionMode:platformSettings.pricing?.feeCollectionMode,
    });
    const bookingPricing = {
      totalPrice: {
        amount: pricing.totalAmount,
        currency: quote.currency,
      },
      subtotalPrice: {
        amount: pricing.subtotalAmount,
        currency: quote.currency,
      },
      platformFeeAmount: pricing.platformFeeAmount,
      buyerFeeAmount: pricing.buyerFeeAmount,
      organiserFeeAmount: pricing.organiserFeeAmount,
      organiserPayoutAmount: pricing.organiserPayoutAmount,
      feePercentage: pricing.percentage,
      feeMode: pricing.mode,
    };

    // 3. Initialize logic based on payment method
    const reference = `MNS-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const { paymentMethod } = req.body;

    if (paymentMethod === "paystack" || !paymentMethod) {
      // Get the authentic event center owner's subaccount details
      const owner = await User.findById(eventCenter.createdBy).select(
        "vendorAccountCode bankDetails",
      );

      const isReviewMode = eventCenter.bookingSettings === "REVIEW";
      if (isReviewMode) require("../../services/venueReviewPolicy.service").assertReviewOpen({ selectedDates: quote.selectedDates, bookingUnit });
      if(!isReviewMode && !owner?.vendorAccountCode)return res.status(409).json({success:false,message:"The organiser must connect a payout account before accepting online payments."});
      if(isReviewMode && (!owner?.bankDetails?.accountNumber || !owner?.bankDetails?.bankCode || quote.currency!=="NGN"))return res.status(409).json({success:false,message:"Review bookings require a connected NGN payout bank account."});

      // Persist immutable checkout details before contacting the payment provider.
      const pending = await require("../../services/venueCheckout.service").reserveVenueCheckout(eventCenterId, eventCenter.updatedAt, {
        buyer: buyerId, organiser: eventCenter.createdBy, guestDetails: { fullName, phoneNumber, email }, selectedDates: quote.selectedDates,
        bookingUnit, duration: quote.duration, ...bookingPricing, paymentReference: reference, paymentStatus: "PENDING",
        checkoutSnapshotVersion: 1, checkoutSubaccount: isReviewMode ? undefined : owner.vendorAccountCode,
        bookingMode: isReviewMode ? "REVIEW" : "INSTANT", payoutDestination: isReviewMode ? owner.bankDetails : undefined,
      });
      const result = await require("../../services/venueCheckoutAttempt.service").resumeVenueCheckout(pending._id, gateway);
      return res.status(result.data.checkoutPending ? 202 : 201).json(result);
    }
  } catch (err) {
    console.error("[CREATE EVENT CENTER TICKET ERROR]", err);
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Server error during ticket creation",
    });
  }
};

// ===================== VERIFY PAYMENT & FINALIZE BOOKING =====================
const verifyPayment = async (req, res) => {
  try {
    const existing = await EventCenterBooking.findOne({ paymentReference: req.params.reference, buyer: req.user.id }).lean();
    if (!existing) return res.status(404).json({ success: false, message: "Booking not found." });
    if (["REFUNDED", "FAILED_REFUND"].includes(existing.paymentStatus) || existing.cancellation?.refundMode === "DIRECT") return res.status(409).json({ success: false,
      message: existing.cancellation?.refundMode === "DIRECT" ? "This booking was cancelled. Track the organiser's manual refund from the booking." : existing.paymentStatus === "REFUNDED" ? "This booking was not confirmed and its automatic reversal is complete." : "The automatic reversal needs support review. Check payment history; do not pay again.", data: existing });
    const payment = await gateway.verifyPayment(req.params.reference);
    const result = await completePayment(req.params.reference,payment,{buyerId:req.user.id,kind:"EVENT_CENTER"});
    if(result.conflict) return res.status(409).json({success:false,message:"Payment received, but the booking could not be confirmed. An automatic reversal is being tracked in payment history. Do not pay again.",data:result.booking});
    await recordBookingReferral(result.booking._id,"EVENT_CENTER_BOOKING");
    await notifyPaymentCompletion(result);
    return res.json({success:true,message:"Payment verified",data:result.booking});
  } catch(error) {
    return res.status(error.statusCode || 502).json({success:false,message:error.statusCode ? error.message : "Could not verify payment. Please try again."});
  }
};

const getMyTickets = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {
      buyer: req.user.id,
      ...(req.query.needsAttention === "true" ? {
        $or: [{ paymentResolutionRequired: true }, { paymentStatus: "FAILED_REFUND" }],
      } : {}),
    };

    const [tickets, total] = await Promise.all([
      EventCenterBooking.find(filter)
        .populate("eventCenter", "venueName images location")
        .select("buyer guestDetails eventCenter selectedDates bookingUnit duration totalPrice paymentStatus status paymentReference paymentResolutionRequired ticketNumber bookingMode reviewDeadline createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EventCenterBooking.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tickets,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ============================================================================
// VALIDATE TICKET (FOR ENTRY CONTROL)
// Atomic findOneAndUpdate prevents race conditions at scale.
// ============================================================================
const validateTicket = async (req, res) => {
  const { ticketNumber, qrPayload } = req.body;
  const staffId = req.user.id;

  try {
    let lookupTicketNumber = ticketNumber;

    // If QR payload is provided, verify signature first
    if (qrPayload) {
      const { valid, data } = verifyQRPayload(qrPayload);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid or tampered QR code. This booking pass may be forged.",
        });
      }
      lookupTicketNumber = data.tn;
    }

    if (!lookupTicketNumber) {
      return res.status(400).json({
        success: false,
        message: "Ticket number or QR payload is required.",
      });
    }

    // Ownership check: verify caller is authorised to scan for this venue
    const existingTicket = await EventCenterBooking.findOne({ ticketNumber: lookupTicketNumber })
      .select("eventCenter")
      .lean();

    if (!existingTicket) {
      return res.status(404).json({
        success: false,
        message: "Booking pass not found. Please check the code and try again.",
      });
    }

    const auth = await authorizeScanAccess(req.user.id, existingTicket.eventCenter);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const ticket = await EventCenterBooking.findOne({ ticketNumber: lookupTicketNumber })
      .populate("buyer", "firstName surname email").populate("eventCenter", "venueName");
    const attendance = await require("../../services/bookingAttendance.service").checkInCurrentSession({
      booking: ticket, eventCenterId: String(ticket.eventCenter?._id || ticket.eventCenter),
      actor: staffId, method: qrPayload ? "QR" : "MANUAL", proofVerified: true,
    });

    res.status(200).json({
      success: true,
      message: "✅ Booking pass validated — Welcome!",
      data: {
        ticketNumber: ticket.ticketNumber,
        guestName: ticket.buyer
          ? `${ticket.buyer.firstName} ${ticket.buyer.surname}`
          : ticket.guestDetails?.fullName || "Guest",
        venueName: ticket.eventCenter?.venueName,
        checkedInAt: attendance.recordedAt,
      },
    });
  } catch (error) {
    console.error("[VALIDATE EVENT CENTER TICKET ERROR]", error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Server error during ticket validation.",
    });
  }
};

// ============================================================================
// GET SINGLE TICKET BY ID
// ============================================================================
const getTicketById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const ticket = await EventCenterBooking.findOne({ _id: id, buyer: userId })
      .populate("eventCenter")
      .populate("buyer", "firstName surname email phoneNumber");

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found." });
    }

    res.status(200).json({
      success: true,
      data: require("../../services/guestVenueBooking.service").guestVenueBooking(ticket),
    });
  } catch (error) {
    console.error("[GET EVENT CENTER TICKET BY ID ERROR]", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error fetching booking details",
      });
  }
};

/**
 * VERIFY TICKET (NON-DESTRUCTIVE LOOKUP)
 * Returns ticket info without marking it as redeemed.
 */
const verifyTicket = async (req, res) => {
  const { ticketNumber, qrPayload } = req.body;

  try {
    let lookupTicketNumber = ticketNumber;

    if (qrPayload) {
      const { valid, data } = verifyQRPayload(qrPayload);
      if (!valid) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or tampered QR code." });
      }
      lookupTicketNumber = data.tn;
    }

    if (!lookupTicketNumber) {
      return res
        .status(400)
        .json({ success: false, message: "Ticket number required." });
    }

    const ticket = await EventCenterBooking.findOne({
      ticketNumber: lookupTicketNumber,
    })
      .populate("buyer", "firstName surname email phoneNumber")
      .populate("eventCenter", "venueName location totalPrice bookingUnit");

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Booking pass not found." });
    }

    const auth = await authorizeScanAccess(req.user.id, ticket.eventCenter?._id || ticket.eventCenter);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const current = await require("../../services/bookingAttendance.service").currentSessionCheckIn(ticket, String(ticket.eventCenter?._id || ticket.eventCenter));
    res.status(200).json({
      success: true,
      data: {
        ticketNumber: ticket.ticketNumber,
        guestName: ticket.buyer
          ? `${ticket.buyer.firstName} ${ticket.buyer.surname}`
          : ticket.guestDetails?.fullName || "Guest",
        guestEmail: ticket.buyer?.email || ticket.guestDetails?.email,
        guestPhone:
          ticket.buyer?.phoneNumber || ticket.guestDetails?.phoneNumber,
        venueName: ticket.eventCenter?.venueName,
        status: ticket.status,
        paymentStatus: ticket.paymentStatus,
        totalPrice: ticket.totalPrice,
        bookingUnit: ticket.bookingUnit,
        duration: ticket.duration,
        selectedDates: ticket.selectedDates,
        isCheckedIn: current.isCheckedIn,
        checkedInAt: current.checkedInAt,
        type: "EVENT_CENTER",
      },
    });
  } catch (error) {
    console.error("[VERIFY EVENT CENTER TICKET ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error during verification." });
  }
};

// ===================== ACCEPT BOOKING (REVIEW MODE) =====================
const acceptBooking = async (req, res) => {
  const { id } = req.params;
  const organiserId = req.user.id;

  try {
    const {confirmReviewBooking}=require("../../services/venuePayout.service");
    const {booking:updated,changed}=await confirmReviewBooking(id,organiserId);
    if(!changed)return res.json({success:true,message:"Booking already confirmed. Payout is tracked separately.",data:updated});
    await recordBookingReferral(updated._id, "EVENT_CENTER_BOOKING");

    return res.status(200).json({
      success: true,
      message: "Booking accepted and confirmed. Organiser payout has been queued.",
      data: updated,
    });
  } catch (err) {
    console.error("[ACCEPT BOOKING ERROR]", err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.statusCode ? err.message : "Server error accepting booking." });
  }
};

// ===================== DECLINE BOOKING (REVIEW MODE) =====================
const declineBooking = async (req, res) => {
  try {
    const ticket = await EventCenterBooking.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Booking not found." });
    if (String(ticket.organiser) !== req.user.id) return res.status(403).json({ success: false, message: "Not authorized to decline this booking." });
    const updated = await require("../../services/venueLifecycle.service").cancelVenueBooking(ticket._id, { actor: req.user.id, mode: "decline", reason: req.body.reason });
    return res.json({ success: true, message: "Booking declined. Any refund is tracked separately.", data: updated });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Could not decline booking." });
  }
};

module.exports = {
  createTicket,
  verifyPayment,
  getMyTickets,
  validateTicket,
  verifyTicket,
  getTicketById,
  acceptBooking,
  declineBooking,
};
