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
      const horizonDate = maximumBookingDate
        ? new Date(`${maximumBookingDate}T23:59:59.999Z`)
        : new Date();
      if (!maximumBookingDate) {
        horizonDate.setMonth(horizonDate.getMonth() + maxMonths);
      }

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

    // 2b. Validate selected dates are still available
    if (bookingUnit === "day" && selectedDates && selectedDates.length > 0) {
      const requestedDates = selectedDates.map(d =>
        new Date(d.date).toISOString().split("T")[0]
      );
      const blockedDates = (eventCenter.availability?.unavailableDates || [])
        .filter(d => d.type === "BOOKED" || d.type === "BLOCKED" || d.type === "MANUAL")
        .map(d => new Date(d.date).toISOString().split("T")[0]);

      const conflicts = requestedDates.filter(d => blockedDates.includes(d));
      if (conflicts.length > 0) {
        return res.status(400).json({
          success: false,
          message: "One or more selected dates are no longer available. Please choose different dates.",
        });
      }
    }

    // 2b-hourly. Validate hourly slots don't conflict
    if (bookingUnit === "hour" && selectedDates && selectedDates.length > 0) {
      const existingSlots = eventCenter.availability?.unavailableSlots || [];
      const conflictingSlots = selectedDates.filter((slot) =>
        hasSlotConflict(slot, existingSlots, null)
      );
      if (conflictingSlots.length > 0) {
        return res.status(400).json({
          success: false,
          message: "One or more time slots conflict with an existing booking.",
        });
      }
    }

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

    // 2c. Prevent duplicate pending bookings from rapid double-taps
    const existingPending = await EventCenterBooking.findOne({
      buyer: buyerId,
      eventCenter: eventCenterId,
      paymentStatus: "PENDING",
      status: "ACTIVE",
    }).select("+checkoutAccessCode +checkoutUrl").sort({ createdAt: -1 });

    if (existingPending) {
      const ageMs = Date.now() - new Date(existingPending.createdAt).getTime();
      const savedDates = existingPending.selectedDates.map(d=>({date:new Date(d.date).toISOString().slice(0,10),...(bookingUnit==="hour"?{startTime:d.startTime,endTime:d.endTime}:{})}));
      if (ageMs < 5 * 60 * 1000 && existingPending.checkoutAccessCode && existingPending.bookingUnit === bookingUnit && JSON.stringify(savedDates) === JSON.stringify(quote.selectedDates)) {
        return res.status(201).json({
          success: true,
          message: "You already have a pending booking for this venue.",
          data: {
            reference: existingPending.paymentReference,
            access_code:existingPending.checkoutAccessCode,
            authorization_url:existingPending.checkoutUrl,
            pricing: {
              subtotalAmount: existingPending.subtotalPrice?.amount,
              platformFeeAmount: existingPending.platformFeeAmount,
              buyerFeeAmount: existingPending.buyerFeeAmount,
              organiserFeeAmount: existingPending.organiserFeeAmount,
              totalAmount: existingPending.totalPrice?.amount,
              organiserPayoutAmount: existingPending.organiserPayoutAmount,
              percentage: existingPending.feePercentage,
              mode: existingPending.feeMode,
            },
          },
        });
      }
    }

    // 3. Initialize logic based on payment method
    const reference = `MNS-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const { paymentMethod } = req.body;

    if (paymentMethod === "paystack" || !paymentMethod) {
      // Get the authentic event center owner's subaccount details
      const owner = await User.findById(eventCenter.createdBy).select(
        "vendorAccountCode bankDetails",
      );

      const isReviewMode = eventCenter.bookingSettings === "REVIEW";
      if(!isReviewMode && !owner?.vendorAccountCode)return res.status(409).json({success:false,message:"The organiser must connect a payout account before accepting online payments."});
      if(isReviewMode && (!owner?.bankDetails?.accountNumber || !owner?.bankDetails?.bankCode || quote.currency!=="NGN"))return res.status(409).json({success:false,message:"Review bookings require a connected NGN payout bank account."});

      // Persist immutable checkout details before contacting the payment provider.
      const pending = await EventCenterBooking.create({
        buyer:buyerId,organiser:eventCenter.createdBy,eventCenter:eventCenterId,
        guestDetails:{fullName,phoneNumber,email},selectedDates:quote.selectedDates,
        bookingUnit,duration:quote.duration,...bookingPricing,paymentReference:reference,
        paymentStatus:"PENDING",bookingMode:isReviewMode?"REVIEW":"INSTANT",
        payoutDestination:isReviewMode?owner.bankDetails:undefined,
      });
      // Initialize Paystack Transaction via Service
      // For REVIEW mode: skip subaccount so payment goes to platform account (held until organizer accepts)
      // For INSTANT mode: use subaccount for split payment to organizer
      const paymentData = await gateway.initializePayment({
        email,
        amount: pricing.totalAmount,
        currency: quote.currency,
        reference,
        subaccount: isReviewMode ? undefined : (owner?.vendorAccountCode || undefined),
        transactionCharge: isReviewMode
          ? undefined
          : Math.round(pricing.platformFeeAmount * 100),
        metadata: {
          eventCenterId,
          organiserId: eventCenter.createdBy.toString(), // Securely bind the database owner ID
          buyerId,
          selectedDates,
          bookingUnit,
          duration,
          ...bookingPricing,
          pricing,
          fullName,
          phoneNumber,
          type: "EVENT_CENTER",
          bookingMode: isReviewMode ? "REVIEW" : "INSTANT",
        },
      });

      const { authorization_url, access_code } = paymentData;
      await EventCenterBooking.updateOne({_id:pending._id},{$set:{checkoutAccessCode:access_code,checkoutUrl:authorization_url}});

      return res.status(201).json({
        success: true,
        message: "Payment initialized successfully",
        data: {
          authorization_url,
          access_code,
          reference,
          pricing,
        },
      });
    } else if (paymentMethod === "transfer") {
      const isReviewModeTransfer = eventCenter.bookingSettings === "REVIEW";

      // For REVIEW mode: create as PENDING_REVIEW, no ticket/QR
      // For INSTANT mode: generate ticket number and QR immediately
      const ticketData = {
        buyer: buyerId,
        organiser: eventCenter.createdBy,
        eventCenter: eventCenterId,
        guestDetails: {
          fullName,
          phoneNumber,
          email,
        },
        selectedDates:quote.selectedDates,
        bookingUnit,
        duration:quote.duration,
        ...bookingPricing,
        paymentReference: reference,
        paymentStatus: "PENDING",
      };

      if (isReviewModeTransfer) {
        ticketData.status = "PENDING_REVIEW";
        ticketData.bookingMode = "REVIEW";
        ticketData.reviewDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      } else {
        ticketData.ticketNumber = generateTicketNumber("MNS");
        ticketData.qrPayload = generateQRPayload(ticketData.ticketNumber, eventCenterId, "EVENT_CENTER");
      }

      const newTicket = new EventCenterBooking(ticketData);

      const savedTicket = await newTicket.save();

      // Update event center availability for transfer bookings (both INSTANT and REVIEW modes)
      const eventCenterDoc = await EventCenter.findById(eventCenterId);
        if (eventCenterDoc) {
          if (!eventCenterDoc.availability) {
            eventCenterDoc.availability = {
              unavailableDates: [],
              unavailableSlots: [],
            };
          }

          if (bookingUnit === "day") {
            const datesToMark = (selectedDates || []).map(
              (d) => new Date(d.date).toISOString().split("T")[0]
            );
            const currentUnavailableStrings = (
              eventCenterDoc.availability.unavailableDates || []
            ).map((d) => new Date(d.date).toISOString().split("T")[0]);

            const newDateStrings = datesToMark.filter(
              (d) => !currentUnavailableStrings.includes(d)
            );

            newDateStrings.forEach((dateStr) => {
              eventCenterDoc.availability.unavailableDates.push({
                date: new Date(dateStr),
                type: "BOOKED",
                bookingId: String(savedTicket._id),
                clientName: fullName || savedTicket.guestDetails?.fullName || "",
                clientPhone: phoneNumber || savedTicket.guestDetails?.phoneNumber || "",
                clientEmail: savedTicket.guestDetails?.email || "",
              });
            });
          } else if (bookingUnit === "hour") {
            // Check for overlapping slots before adding
            const existingSlots = eventCenterDoc.availability.unavailableSlots || [];
            const conflictingSlots = (selectedDates || []).filter((slot) =>
              hasSlotConflict(slot, existingSlots, null)
            );

            if (conflictingSlots.length > 0) {
              return res.status(400).json({
                success: false,
                message: "One or more time slots conflict with an existing booking",
              });
            }

            const newSlots = (selectedDates || []).map((slot) => ({
              date: new Date(slot.date),
              startTime: slot.startTime,
              endTime: slot.endTime,
              type: "BOOKED",
              bookingId: String(savedTicket._id),
              clientName: fullName || savedTicket.guestDetails?.fullName || "",
              clientPhone: phoneNumber || savedTicket.guestDetails?.phoneNumber || "",
              clientEmail: savedTicket.guestDetails?.email || "",
            }));

            if (!eventCenterDoc.availability.unavailableSlots) {
              eventCenterDoc.availability.unavailableSlots = [];
            }
            eventCenterDoc.availability.unavailableSlots.push(...newSlots);
          }

          await eventCenterDoc.save();
      }

      // Send notification to organizer
      const transferGuestName = fullName || savedTicket.guestDetails?.fullName || "A guest";
      const transferVenueName = (await EventCenter.findById(eventCenterId).select("venueName").lean())?.venueName || "your venue";
      if (isReviewModeTransfer) {
        await dispatchNotification({
          recipient: eventCenter.createdBy,
          sender: buyerId,
          type: NOTIFICATION_TYPES.BOOKING_REQUEST,
          title: "New Booking Request ⏳",
          message: `${transferGuestName} requested to book ${transferVenueName}. Review within 24 hours.`,
          referenceId: savedTicket._id,
          referenceType: "EventCenterBooking",
          data: {
            screen: "BookingReview",
            ticketId: String(savedTicket._id),
            eventCenterId: String(eventCenterId),
          },
        });
      }

      // Log booking history
      logBookingHistory({
        eventCenter: eventCenterId,
        ticket: savedTicket._id,
        bookingId: String(savedTicket._id),
        bookingType: "PLATFORM",
        action: "CREATED",
        performedBy: buyerId,
        dates: selectedDates,
        guestName: fullName || savedTicket.guestDetails?.fullName || "",
        totalPrice: totalPrice,
      });

      return res.status(201).json({
        success: true,
        message: "Booking request submitted (Manual transfer)",
        data: savedTicket,
      });
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
    const payment = await gateway.verifyPayment(req.params.reference);
    const result = await completePayment(req.params.reference,payment,{buyerId:req.user.id,kind:"EVENT_CENTER"});
    if(result.conflict) return res.status(409).json({success:false,message:"Payment received, but the selected dates could not be confirmed. Please contact the organiser.",data:result.booking});
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

    const [tickets, total] = await Promise.all([
      EventCenterBooking.find({ buyer: req.user.id })
        .populate("eventCenter", "venueName images location")
        .select("buyer guestDetails eventCenter selectedDates bookingUnit duration totalPrice paymentStatus status paymentReference ticketNumber bookingMode reviewDeadline createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EventCenterBooking.countDocuments({ buyer: req.user.id }),
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
      data: ticket,
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
    const eventCenter=await EventCenter.findById(updated.eventCenter);

    await recordBookingReferral(updated._id, "EVENT_CENTER_BOOKING");

    // Send notification to buyer
    const venueName = eventCenter?.venueName || "your venue";
    const bookingDatesStr = Array.isArray(updated.selectedDates)
      ? updated.selectedDates.map((d) => (d.date ? new Date(d.date).toLocaleDateString() : String(d))).join(", ")
      : "";

    await dispatchNotification({
      recipient: updated.buyer,
      sender: organiserId,
      type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
      title: "Booking Confirmed! 🎉",
      message: `Your booking at ${venueName} has been confirmed. Your ticket is ready.`,
      referenceId: updated._id,
      referenceType: "EventCenterBooking",
      data: {
        screen: "TicketDetails",
        ticketId: String(updated._id),
      },
      email: {
        subject: `Booking Confirmed: ${venueName} - Munasaba`,
        html: emailTemplates.venueBookingTemplate({
          recipientName: updated.guestDetails?.fullName || "Guest",
          title: "Booking Confirmed!",
          message: `Your booking at ${venueName} has been confirmed by the host. Your digital ticket is ready in your app.`,
          venueName,
          bookingDates: bookingDatesStr,
          totalAmount: updated.totalPrice,
          status: "CONFIRMED",
        }),
      },
    });

    // Log booking history with correct action
    logBookingHistory({
      eventCenter: updated.eventCenter,
      ticket: updated._id,
      bookingId: String(updated._id),
      bookingType: "PLATFORM",
      bookingUnit: updated.bookingUnit,
      action: "ACCEPTED",
      performedBy: organiserId,
      dates: updated.selectedDates,
      guestName: updated.guestDetails?.fullName || "",
      totalPrice: updated.totalPrice,
    });

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
  const { id } = req.params;
  const { reason } = req.body;
  const organiserId = req.user.id;

  try {
    const ticket = await EventCenterBooking.findById(id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    if (String(ticket.organiser) !== organiserId) {
      return res.status(403).json({ success: false, message: "Not authorized to decline this booking." });
    }

    // Atomic status transition: only succeeds if still PENDING_REVIEW
    const updated = await EventCenterBooking.findOneAndUpdate(
      { _id: id, status: "PENDING_REVIEW" },
      {
        $set: {
          status: "CANCELLED",
          reviewedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!updated) {
      const current = await EventCenterBooking.findById(id).select("status").lean();
      return res.status(400).json({ success: false, message: `Booking is already ${current?.status || "unknown"}.` });
    }

    // Refund payment if it was completed
    let refundSucceeded = false;
    if (updated.paymentStatus === "COMPLETED" && updated.paymentReference) {
      try {
        await gateway.refundPayment(updated.paymentReference);
        updated.paymentStatus = "REFUNDED";
        refundSucceeded = true;
      } catch (refundErr) {
        console.error("[DECLINE BOOKING] Refund failed:", refundErr.message);
        updated.paymentStatus = "FAILED_REFUND";
      }
      await updated.save();
    }

    // Remove date/slot blocks from EventCenter
    const eventCenterDoc = await EventCenter.findById(updated.eventCenter);
    if (eventCenterDoc?.availability) {
      const ticketIdStr = String(updated._id);

      if (updated.bookingUnit === "day" && eventCenterDoc.availability.unavailableDates) {
        eventCenterDoc.availability.unavailableDates =
          eventCenterDoc.availability.unavailableDates.filter(
            (d) => String(d.bookingId) !== ticketIdStr
          );
      } else if (updated.bookingUnit === "hour" && eventCenterDoc.availability.unavailableSlots) {
        eventCenterDoc.availability.unavailableSlots =
          eventCenterDoc.availability.unavailableSlots.filter(
            (s) => String(s.bookingId) !== ticketIdStr
          );
      }

      await eventCenterDoc.save();
    }

    // Send notification to buyer
    const eventCenter = await EventCenter.findById(updated.eventCenter).select("venueName").lean();
    const venueName = eventCenter?.venueName || "your venue";
    const refundNote = refundSucceeded
      ? " A full refund has been issued."
      : updated.paymentStatus === "FAILED_REFUND"
        ? " A refund could not be processed automatically. Please contact support."
        : "";

    await dispatchNotification({
      recipient: updated.buyer,
      sender: organiserId,
      type: NOTIFICATION_TYPES.BOOKING_DECLINED,
      title: "Booking Declined",
      message: `Your booking at ${venueName} was declined.${refundNote}`,
      referenceId: updated._id,
      referenceType: "EventCenterBooking",
      data: {
        screen: "BookingDetails",
        ticketId: String(updated._id),
      },
      email: {
        subject: `Booking Declined: ${venueName} - Munasaba`,
        html: emailTemplates.venueBookingTemplate({
          recipientName: updated.guestDetails?.fullName || "Guest",
          title: "Booking Declined",
          message: `Your booking request for ${venueName} was declined by the host.${refundNote}`,
          venueName,
          totalAmount: updated.totalPrice,
          status: "DECLINED",
        }),
      },
    });

    // Log booking history with correct action
    logBookingHistory({
      eventCenter: updated.eventCenter,
      ticket: updated._id,
      bookingId: String(updated._id),
      bookingType: "PLATFORM",
      bookingUnit: updated.bookingUnit,
      action: "DECLINED",
      performedBy: organiserId,
      dates: updated.selectedDates,
      guestName: updated.guestDetails?.fullName || "",
      totalPrice: updated.totalPrice,
      reason: reason || "Declined by organizer",
    });

    return res.status(200).json({
      success: true,
      message: "Booking declined.",
      data: updated,
    });
  } catch (err) {
    console.error("[DECLINE BOOKING ERROR]", err);
    return res.status(500).json({ success: false, message: "Server error declining booking." });
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
