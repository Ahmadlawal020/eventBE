const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const User = require("../../models/user/user.schema");
const Notification = require("../../models/user/notification.schema");
const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { getPaymentGateway } = require("../../services/payment");
const { generateTicketNumber, generateQRPayload, verifyQRPayload } = require("../../utils/qr");
const { hasSlotConflict } = require("../../utils/slotConflict");
const { logBookingHistory } = require("./bookingHistory.controller");

const gateway = getPaymentGateway();

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

  const coHostInvite = await CoHostInvitation.findOne({
    coHost: userId,
    host: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: { $in: ["SCAN_TICKET", "ALL_ACCESS"] },
  }).lean();
  if (coHostInvite) return { authorized: true };

  const staffInvite = await StaffInvitation.findOne({
    staff: userId,
    organiser: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: "SCAN_TICKET",
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

    // 2c. Prevent duplicate pending bookings from rapid double-taps
    const existingPending = await EventCenterBooking.findOne({
      buyer: buyerId,
      eventCenter: eventCenterId,
      paymentStatus: "PENDING",
      status: "ACTIVE",
    }).sort({ createdAt: -1 });

    if (existingPending) {
      const ageMs = Date.now() - new Date(existingPending.createdAt).getTime();
      if (ageMs < 5 * 60 * 1000) {
        return res.status(201).json({
          success: true,
          message: "You already have a pending booking for this venue.",
          data: { reference: existingPending.paymentReference },
        });
      }
    }

    // 3. Initialize logic based on payment method
    const reference = `MNS-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const { paymentMethod } = req.body;

    if (paymentMethod === "paystack" || !paymentMethod) {
      // Get the authentic event center owner's subaccount details
      const owner = await User.findById(eventCenter.createdBy).select(
        "vendorAccountCode",
      );

      const isReviewMode = eventCenter.bookingSettings === "REVIEW";

      // Initialize Paystack Transaction via Service
      // For REVIEW mode: skip subaccount so payment goes to platform account (held until organizer accepts)
      // For INSTANT mode: use subaccount for split payment to organizer
      const paymentData = await gateway.initializePayment({
        email,
        amount: totalPrice.amount,
        reference,
        subaccount: isReviewMode ? undefined : (owner?.vendorAccountCode || undefined),
        metadata: {
          eventCenterId,
          organiserId: eventCenter.createdBy.toString(), // Securely bind the database owner ID
          buyerId,
          selectedDates,
          bookingUnit,
          duration,
          totalPrice,
          fullName,
          phoneNumber,
          type: "EVENT_CENTER",
          bookingMode: isReviewMode ? "REVIEW" : "INSTANT",
        },
      });

      const { authorization_url, access_code } = paymentData;

      return res.status(201).json({
        success: true,
        message: "Payment initialized successfully",
        data: {
          authorization_url,
          access_code,
          reference,
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
        selectedDates,
        bookingUnit,
        duration,
        totalPrice,
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
        await Notification.create({
          recipient: eventCenter.createdBy,
          sender: buyerId,
          type: "BOOKING_UPDATE",
          title: "New Booking Request",
          message: `${transferGuestName} requested to book ${transferVenueName}. Review within 24 hours.`,
          referenceId: savedTicket._id,
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
    res.status(500).json({
      success: false,
      message: "Server error during ticket creation",
    });
  }
};

// ===================== VERIFY PAYMENT & FINALIZE BOOKING =====================
const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  if (!reference) {
    return res
      .status(400)
      .json({ success: false, message: "Missing payment reference." });
  }

  try {
    // 1. Verify with payment gateway
    const paymentData = await gateway.verifyPayment(reference);

    // Check if Paystack says it's successful
    if (paymentData.status !== "success") {
      return res.status(200).json({
        success: false,
        message: `Transaction is currently ${paymentData.status}.`,
        data: paymentData,
      });
    }

    // 2. Check if a ticket already exists for this reference (prevent duplicates)
    let ticket = await EventCenterBooking.findOne({
      paymentReference: reference,
    });

    if (ticket && ticket.paymentStatus === "COMPLETED") {
      return res.json({
        success: true,
        message: "Payment already verified.",
        data: ticket,
      });
    }

    // 3. Extract booking details from Paystack Metadata
    const meta = paymentData.metadata;
    const {
      eventCenterId,
      organiserId,
      buyerId,
      selectedDates,
      bookingUnit,
      duration,
      totalPrice,
      fullName,
      phoneNumber,
    } = meta;

    // 4. Determine booking mode
    const eventCenter = await EventCenter.findById(eventCenterId).select("bookingSettings venueName availability").lean();
    const isReviewMode = eventCenter?.bookingSettings === "REVIEW" || meta.bookingMode === "REVIEW";

    // 4b. Validate selected dates are still available
    if (bookingUnit === "day" && selectedDates && selectedDates.length > 0) {
      const requestedDates = selectedDates.map(d =>
        new Date(d.date).toISOString().split("T")[0]
      );
      const blockedDates = (eventCenter?.availability?.unavailableDates || [])
        .filter(d => d.type === "BOOKED" || d.type === "BLOCKED" || d.type === "MANUAL")
        .map(d => new Date(d.date).toISOString().split("T")[0]);

      const conflicts = requestedDates.filter(d => blockedDates.includes(d));
      if (conflicts.length > 0) {
        return res.status(400).json({
          success: false,
          message: "One or more selected dates are no longer available. Payment will be refunded.",
        });
      }
    }

    if (!ticket) {
      const ticketData = {
        buyer: buyerId,
        organiser: organiserId,
        eventCenter: eventCenterId,
        guestDetails: {
          fullName,
          phoneNumber,
          email: paymentData.customer.email,
        },
        selectedDates,
        bookingUnit,
        duration,
        totalPrice,
        paymentReference: reference,
        paymentStatus: "COMPLETED",
      };

      if (isReviewMode) {
        ticketData.status = "PENDING_REVIEW";
        ticketData.bookingMode = "REVIEW";
        ticketData.reviewDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      } else {
        ticketData.ticketNumber = generateTicketNumber("MNS");
        ticketData.qrPayload = generateQRPayload(ticketData.ticketNumber, eventCenterId, "EVENT_CENTER");
      }

      ticket = new EventCenterBooking(ticketData);
    } else {
      // Existing ticket being completed
      ticket.paymentStatus = "COMPLETED";
      if (isReviewMode) {
        ticket.status = "PENDING_REVIEW";
        ticket.bookingMode = "REVIEW";
        ticket.reviewDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      } else {
        if (!ticket.ticketNumber) {
          ticket.ticketNumber = generateTicketNumber("MNS");
          ticket.qrPayload = generateQRPayload(
            ticket.ticketNumber,
            ticket.eventCenter,
            "EVENT_CENTER",
          );
        }
      }
    }

    try {
      await ticket.save();
    } catch (saveErr) {
      // E11000 = duplicate key on paymentReference — webhook created it concurrently
      if (saveErr.code === 11000) {
        const existingTicket = await EventCenterBooking.findOne({ paymentReference: reference });
        if (existingTicket) {
          return res.json({
            success: true,
            message: "Payment verified (processed by webhook).",
            data: existingTicket,
          });
        }
      }
      throw saveErr;
    }

    // 5. Update Event Center availability to prevent double-booking (both INSTANT and REVIEW modes)
    //    For REVIEW mode, dates are blocked immediately. If organizer declines, blocks are removed.
    const ec = await EventCenter.findById(ticket.eventCenter);
    if (ec) {
      if (!ec.availability) {
        ec.availability = {
          unavailableDates: [],
          unavailableSlots: [],
        };
      }

        if (ticket.bookingUnit === "day") {
          const datesToMark = (ticket.selectedDates || []).map(
            (d) => new Date(d.date).toISOString().split("T")[0],
          );

          const currentUnavailableStrings = (
            ec.availability.unavailableDates || []
          ).map((d) => new Date(d.date).toISOString().split("T")[0]);

          const newDateStrings = datesToMark.filter(
            (d) => !currentUnavailableStrings.includes(d),
          );

          newDateStrings.forEach((dateStr) => {
            ec.availability.unavailableDates.push({
              date: new Date(dateStr),
              type: "BOOKED",
              bookingId: String(ticket._id),
              clientName: fullName || ticket.guestDetails?.fullName || "",
              clientPhone: phoneNumber || ticket.guestDetails?.phoneNumber || "",
              clientEmail: ticket.guestDetails?.email || paymentData?.customer?.email || "",
            });
          });
        } else if (ticket.bookingUnit === "hour") {
          const existingSlots = ec.availability.unavailableSlots || [];
          const conflictingSlots = (ticket.selectedDates || []).filter((slot) =>
            hasSlotConflict(slot, existingSlots, String(ticket._id))
          );

          if (conflictingSlots.length > 0) {
            return res.status(400).json({
              success: false,
              message: "One or more time slots conflict with an existing booking",
            });
          }

          const newSlots = (ticket.selectedDates || []).map((slot) => ({
            date: new Date(slot.date),
            startTime: slot.startTime,
            endTime: slot.endTime,
            type: "BOOKED",
            bookingId: String(ticket._id),
            clientName: fullName || ticket.guestDetails?.fullName || "",
            clientPhone: phoneNumber || ticket.guestDetails?.phoneNumber || "",
            clientEmail: ticket.guestDetails?.email || paymentData?.customer?.email || "",
          }));

          if (!ec.availability.unavailableSlots) {
            ec.availability.unavailableSlots = [];
          }

          ec.availability.unavailableSlots.push(...newSlots);
        }

        await ec.save();
      }

    // 6. Send notifications
    const guestName = fullName || ticket.guestDetails?.fullName || "A guest";
    const venueName = eventCenter?.venueName || "your venue";

    if (isReviewMode) {
      await Notification.create({
        recipient: organiserId,
        sender: buyerId,
        type: "BOOKING_UPDATE",
        title: "New Booking Request",
        message: `${guestName} requested to book ${venueName}. Review within 24 hours.`,
        referenceId: ticket._id,
      });
    } else {
      await Notification.create({
        recipient: organiserId,
        sender: buyerId,
        type: "BOOKING_UPDATE",
        title: "New Booking!",
        message: `${guestName} booked ${venueName}.`,
        referenceId: ticket._id,
      });
    }

    // Log booking history
    logBookingHistory({
      eventCenter: ticket.eventCenter,
      ticket: ticket._id,
      bookingId: String(ticket._id),
      bookingType: "PLATFORM",
      action: "CREATED",
      performedBy: buyerId,
      dates: ticket.selectedDates,
      guestName: fullName || ticket.guestDetails?.fullName || "",
      totalPrice: ticket.totalPrice,
    });

    const successMessage = isReviewMode
      ? "Payment verified. Booking is pending organizer review."
      : "Payment verified and booking confirmed successfully.";

    return res.status(200).json({
      success: true,
      message: successMessage,
      data: ticket,
    });
  } catch (err) {
    console.error("[EVENT CENTER PAYMENT VERIFICATION ERROR]", err.message);
    return res.status(500).json({
      success: false,
      message: "Payment verification failed.",
    });
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

    // Atomic update: only the first scanner wins
    const ticket = await EventCenterBooking.findOneAndUpdate(
      {
        ticketNumber: lookupTicketNumber,
        status: { $in: ["ACTIVE", "CONFIRMED"] },
        "checkIn.isCheckedIn": { $ne: true },
      },
      {
        $set: {
          "checkIn.isCheckedIn": true,
          "checkIn.checkedInAt": new Date(),
          "checkIn.checkedInBy": staffId,
          "checkIn.method": qrPayload ? "QR" : "MANUAL",
        },
      },
      { new: true },
    )
      .populate("buyer", "firstName surname email")
      .populate("eventCenter", "venueName");

    if (!ticket) {
      // Check why it failed
      const existingTicket = await EventCenterBooking.findOne({
        ticketNumber: lookupTicketNumber,
      })
        .select("status checkIn guestDetails")
        .lean();

      if (!existingTicket) {
        return res.status(404).json({
          success: false,
          message:
            "Booking pass not found. Please check the code and try again.",
        });
      }

      if (existingTicket.checkIn?.isCheckedIn) {
        return res.status(409).json({
          success: false,
          message:
            "⚠️ DUPLICATE ENTRY — This booking pass has already been used.",
          data: {
            checkedInAt: existingTicket.checkIn.checkedInAt,
            guestName: existingTicket.guestDetails?.fullName,
          },
        });
      }

      if (existingTicket.status === "CANCELLED") {
        return res.status(400).json({
          success: false,
          message: "This booking has been cancelled.",
        });
      }

      return res.status(400).json({
        success: false,
        message: `Booking status: ${existingTicket.status}`,
      });
    }

    res.status(200).json({
      success: true,
      message: "✅ Booking pass validated — Welcome!",
      data: {
        ticketNumber: ticket.ticketNumber,
        guestName: ticket.buyer
          ? `${ticket.buyer.firstName} ${ticket.buyer.surname}`
          : ticket.guestDetails?.fullName || "Guest",
        venueName: ticket.eventCenter?.venueName,
        checkedInAt: ticket.checkIn?.checkedInAt,
      },
    });
  } catch (error) {
    console.error("[VALIDATE EVENT CENTER TICKET ERROR]", error);
    res.status(500).json({
      success: false,
      message: "Server error during ticket validation.",
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
        isCheckedIn: ticket.checkIn?.isCheckedIn,
        checkedInAt: ticket.checkIn?.checkedInAt,
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
    const ticket = await EventCenterBooking.findById(id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    if (String(ticket.organiser) !== organiserId) {
      return res.status(403).json({ success: false, message: "Not authorized to accept this booking." });
    }

    if (ticket.status !== "PENDING_REVIEW") {
      return res.status(400).json({ success: false, message: `Booking is already ${ticket.status}.` });
    }

    // Generate ticket number and QR payload
    const ticketNumber = generateTicketNumber("MNS");
    const qrPayload = generateQRPayload(ticketNumber, ticket.eventCenter, "EVENT_CENTER");

    ticket.status = "CONFIRMED";
    ticket.ticketNumber = ticketNumber;
    ticket.qrPayload = qrPayload;
    ticket.reviewedAt = new Date();
    await ticket.save();

    // Mark dates/slots unavailable on EventCenter
    const eventCenter = await EventCenter.findById(ticket.eventCenter);
    if (eventCenter) {
      if (!eventCenter.availability) {
        eventCenter.availability = { unavailableDates: [], unavailableSlots: [] };
      }

      if (ticket.bookingUnit === "day") {
        const datesToMark = (ticket.selectedDates || []).map(
          (d) => new Date(d.date).toISOString().split("T")[0]
        );
        const currentStrings = (eventCenter.availability.unavailableDates || []).map(
          (d) => new Date(d.date).toISOString().split("T")[0]
        );
        const newDateStrings = datesToMark.filter((d) => !currentStrings.includes(d));

        newDateStrings.forEach((dateStr) => {
          eventCenter.availability.unavailableDates.push({
            date: new Date(dateStr),
            type: "BOOKED",
            bookingId: String(ticket._id),
            clientName: ticket.guestDetails?.fullName || "",
            clientPhone: ticket.guestDetails?.phoneNumber || "",
            clientEmail: ticket.guestDetails?.email || "",
          });
        });
      } else if (ticket.bookingUnit === "hour") {
        const existingSlots = eventCenter.availability.unavailableSlots || [];
        const conflictingSlots = (ticket.selectedDates || []).filter((slot) =>
          hasSlotConflict(slot, existingSlots, String(ticket._id))
        );

        if (conflictingSlots.length === 0) {
          const newSlots = (ticket.selectedDates || []).map((slot) => ({
            date: new Date(slot.date),
            startTime: slot.startTime,
            endTime: slot.endTime,
            type: "BOOKED",
            bookingId: String(ticket._id),
            clientName: ticket.guestDetails?.fullName || "",
            clientPhone: ticket.guestDetails?.phoneNumber || "",
            clientEmail: ticket.guestDetails?.email || "",
          }));

          if (!eventCenter.availability.unavailableSlots) {
            eventCenter.availability.unavailableSlots = [];
          }
          eventCenter.availability.unavailableSlots.push(...newSlots);
        }
      }

      await eventCenter.save();
    }

    // Send notification to buyer
    const venueName = eventCenter?.venueName || "your venue";
    await Notification.create({
      recipient: ticket.buyer,
      sender: organiserId,
      type: "BOOKING_UPDATE",
      title: "Booking Confirmed!",
      message: `Your booking at ${venueName} has been confirmed. Your ticket is ready.`,
      referenceId: ticket._id,
    });

    // Log booking history
    logBookingHistory({
      eventCenter: ticket.eventCenter,
      ticket: ticket._id,
      bookingId: String(ticket._id),
      bookingType: "PLATFORM",
      action: "CREATED",
      performedBy: organiserId,
      dates: ticket.selectedDates,
      guestName: ticket.guestDetails?.fullName || "",
      totalPrice: ticket.totalPrice,
    });

    return res.status(200).json({
      success: true,
      message: "Booking accepted and confirmed.",
      data: ticket,
    });
  } catch (err) {
    console.error("[ACCEPT BOOKING ERROR]", err);
    return res.status(500).json({ success: false, message: "Server error accepting booking." });
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

    if (ticket.status !== "PENDING_REVIEW") {
      return res.status(400).json({ success: false, message: `Booking is already ${ticket.status}.` });
    }

    // Refund payment if it was completed
    let refundSucceeded = false;
    if (ticket.paymentStatus === "COMPLETED" && ticket.paymentReference) {
      try {
        await gateway.refundPayment(ticket.paymentReference);
        ticket.paymentStatus = "REFUNDED";
        refundSucceeded = true;
      } catch (refundErr) {
        console.error("[DECLINE BOOKING] Refund failed:", refundErr.message);
        ticket.paymentStatus = "FAILED_REFUND";
      }
    }

    ticket.status = "CANCELLED";
    ticket.reviewedAt = new Date();
    await ticket.save();

    // Remove date/slot blocks from EventCenter
    const eventCenterDoc = await EventCenter.findById(ticket.eventCenter);
    if (eventCenterDoc?.availability) {
      const ticketIdStr = String(ticket._id);

      if (ticket.bookingUnit === "day" && eventCenterDoc.availability.unavailableDates) {
        eventCenterDoc.availability.unavailableDates =
          eventCenterDoc.availability.unavailableDates.filter(
            (d) => String(d.bookingId) !== ticketIdStr
          );
      } else if (ticket.bookingUnit === "hour" && eventCenterDoc.availability.unavailableSlots) {
        eventCenterDoc.availability.unavailableSlots =
          eventCenterDoc.availability.unavailableSlots.filter(
            (s) => String(s.bookingId) !== ticketIdStr
          );
      }

      await eventCenterDoc.save();
    }

    // Send notification to buyer
    const eventCenter = await EventCenter.findById(ticket.eventCenter).select("venueName").lean();
    const venueName = eventCenter?.venueName || "your venue";
    const refundNote = refundSucceeded
      ? " A full refund has been issued."
      : ticket.paymentStatus === "FAILED_REFUND"
        ? " A refund could not be processed automatically. Please contact support."
        : "";
    await Notification.create({
      recipient: ticket.buyer,
      sender: organiserId,
      type: "BOOKING_UPDATE",
      title: "Booking Declined",
      message: `Your booking at ${venueName} was declined.${refundNote}`,
      referenceId: ticket._id,
    });

    // Log booking history
    logBookingHistory({
      eventCenter: ticket.eventCenter,
      ticket: ticket._id,
      bookingId: String(ticket._id),
      bookingType: "PLATFORM",
      action: "CANCELLED",
      performedBy: organiserId,
      dates: ticket.selectedDates,
      guestName: ticket.guestDetails?.fullName || "",
      totalPrice: ticket.totalPrice,
      reason: reason || "Declined by organizer",
    });

    return res.status(200).json({
      success: true,
      message: "Booking declined.",
      data: ticket,
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
