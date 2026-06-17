const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const User = require("../../models/user/user.schema");
const mongoose = require("mongoose");
const paystackService = require("../../services/paystack.service");
const crypto = require("crypto");

/**
 * Check if a proposed hourly slot overlaps with existing booked slots
 * @param {Object} newSlot - { date, startTime, endTime }
 * @param {Array} existingSlots - array of existing unavailableSlots entries
 * @param {String} excludeBookingId - bookingId to exclude from conflict check
 * @returns {Boolean} true if conflict found
 */
function hasSlotConflict(newSlot, existingSlots, excludeBookingId) {
  const newDateStr = new Date(newSlot.date).toISOString().split("T")[0];
  const newStart = newSlot.startTime;
  const newEnd = newSlot.endTime;

  return existingSlots.some((existing) => {
    const existingDateStr = new Date(existing.date).toISOString().split("T")[0];
    if (existingDateStr !== newDateStr) return false;
    if (excludeBookingId && String(existing.bookingId) === String(excludeBookingId)) return false;
    if (existing.type !== "BOOKED" && existing.type !== "MANUAL") return false;
    return newStart < existing.endTime && newEnd > existing.startTime;
  });
}

// ============================================================================
// QR PAYLOAD SIGNING — Same pattern as event tickets
// ============================================================================
const QR_SECRET =
  process.env.QR_SIGNING_SECRET || "mnb-default-secret-change-in-production";

/**
 * Generate a cryptographically unique ticket number.
 * Format: MNS-XXXXXXXX-XXXX (16 hex chars = 8 bytes = 2^64 combinations)
 * MNS = Munasaba Space (to distinguish from MNB event tickets)
 */
const generateTicketNumber = () => {
  const hex = crypto.randomBytes(8).toString("hex").toUpperCase();
  return `MNS-${hex.slice(0, 8)}-${hex.slice(8)}`;
};

/**
 * Generate a HMAC-signed QR payload for tamper-proof verification.
 */
const generateQRPayload = (ticketNumber, eventCenterId) => {
  const payload = {
    tn: ticketNumber,
    ecid: eventCenterId.toString(), // event center ID
    ts: Date.now(),
    v: 1,
    type: "EVENT_CENTER", // distinguish from event tickets
  };

  const dataString = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", QR_SECRET)
    .update(dataString)
    .digest("hex")
    .slice(0, 12);

  return JSON.stringify({ ...payload, sig: signature });
};

/**
 * Verify the HMAC signature of a scanned QR payload.
 */
const verifyQRPayload = (qrString) => {
  try {
    const parsed = JSON.parse(qrString);
    const { sig, ...data } = parsed;

    const expectedSig = crypto
      .createHmac("sha256", QR_SECRET)
      .update(JSON.stringify(data))
      .digest("hex")
      .slice(0, 12);

    return { valid: sig === expectedSig, data: parsed };
  } catch {
    return { valid: false, data: null };
  }
};

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

    // 3. Initialize logic based on payment method
    const reference = `MNS-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const { paymentMethod } = req.body;

    if (paymentMethod === "paystack" || !paymentMethod) {
      // Get the authentic event center owner's subaccount details
      const owner = await User.findById(eventCenter.createdBy).select(
        "paystackSubaccountCode",
      );

      // Initialize Paystack Transaction via Service
      const paystackData = await paystackService.initializeTransaction({
        email,
        amount: totalPrice.amount,
        reference,
        subaccount: owner?.paystackSubaccountCode || undefined,
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
        },
      });

      const { authorization_url, access_code } = paystackData;

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
      // Generate ticket number and QR for manual transfer bookings
      const ticketNumber = generateTicketNumber();
      const qrPayload = generateQRPayload(ticketNumber, eventCenterId);

      const newTicket = new EventCenterTicket({
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
        paystackReference: reference,
        paymentStatus: "PENDING",
        ticketNumber,
        qrPayload,
      });

      const savedTicket = await newTicket.save();

      // Update event center availability for transfer bookings
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
      error: err.message,
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

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({
      success: false,
      message: "PAYSTACK_SECRET_KEY is not set in environment variables.",
    });
  }

  try {
    // 1. Verify with Paystack Service
    const paystackData = await paystackService.verifyTransaction(reference);

    // Check if Paystack says it's successful
    if (paystackData.status !== "success") {
      return res.status(200).json({
        success: false,
        message: `Transaction is currently ${paystackData.status}.`,
        data: paystackData,
      });
    }

    // 2. Check if a ticket already exists for this reference (prevent duplicates)
    let ticket = await EventCenterTicket.findOne({
      paystackReference: reference,
    });

    if (ticket && ticket.paymentStatus === "COMPLETED") {
      return res.json({
        success: true,
        message: "Payment already verified.",
        data: ticket,
      });
    }

    // 3. Extract booking details from Paystack Metadata
    const meta = paystackData.metadata;
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

    if (!ticket) {
      // Generate ticket number and QR payload for new ticket
      const ticketNumber = generateTicketNumber();
      const qrPayload = generateQRPayload(ticketNumber, eventCenterId);

      ticket = new EventCenterTicket({
        buyer: buyerId,
        organiser: organiserId,
        eventCenter: eventCenterId,
        guestDetails: {
          fullName,
          phoneNumber,
          email: paystackData.customer.email,
        },
        selectedDates,
        bookingUnit,
        duration,
        totalPrice,
        paystackReference: reference,
        paymentStatus: "COMPLETED",
        ticketNumber,
        qrPayload,
      });
    } else {
      // Existing ticket being completed — generate QR if missing
      ticket.paymentStatus = "COMPLETED";
      if (!ticket.ticketNumber) {
        ticket.ticketNumber = generateTicketNumber();
        ticket.qrPayload = generateQRPayload(
          ticket.ticketNumber,
          ticket.eventCenter,
        );
      }
    }

    await ticket.save();

    // 4. Update Event Center availability to prevent double-booking
    const eventCenter = await EventCenter.findById(ticket.eventCenter);
    if (eventCenter) {
      if (!eventCenter.availability) {
        eventCenter.availability = {
          unavailableDates: [],
          unavailableSlots: [],
        };
      }

      if (ticket.bookingUnit === "day") {
        const datesToMark = (ticket.selectedDates || []).map(
          (d) => new Date(d.date).toISOString().split("T")[0],
        );

        const currentUnavailableStrings = (
          eventCenter.availability.unavailableDates || []
        ).map((d) => new Date(d.date).toISOString().split("T")[0]);

        const newDateStrings = datesToMark.filter(
          (d) => !currentUnavailableStrings.includes(d),
        );

        newDateStrings.forEach((dateStr) => {
          eventCenter.availability.unavailableDates.push({
            date: new Date(dateStr),
            type: "BOOKED",
            bookingId: String(ticket._id),
            clientName: fullName || ticket.guestDetails?.fullName || "",
            clientPhone: phoneNumber || ticket.guestDetails?.phoneNumber || "",
            clientEmail: ticket.guestDetails?.email || paystackData?.customer?.email || "",
          });
        });
      } else if (ticket.bookingUnit === "hour") {
        // Check for overlapping slots before adding
        const existingSlots = eventCenter.availability.unavailableSlots || [];
        const conflictingSlots = (ticket.selectedDates || []).filter((slot) =>
          hasSlotConflict(slot, existingSlots, null)
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
          clientEmail: ticket.guestDetails?.email || paystackData?.customer?.email || "",
        }));

        if (!eventCenter.availability.unavailableSlots) {
          eventCenter.availability.unavailableSlots = [];
        }

        eventCenter.availability.unavailableSlots.push(...newSlots);
      }

      await eventCenter.save();
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified and booking confirmed successfully.",
      data: ticket,
    });
  } catch (err) {
    console.error("[EVENT CENTER PAYMENT VERIFICATION ERROR]", err.message);
    return res.status(500).json({
      success: false,
      message: "Payment verification failed.",
      error: err.message,
    });
  }
};

const getMyTickets = async (req, res) => {
  try {
    const tickets = await EventCenterTicket.find({ buyer: req.user.id })
      .populate("eventCenter", "venueName images location")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: tickets });
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

    // Atomic update: only the first scanner wins
    const ticket = await EventCenterTicket.findOneAndUpdate(
      {
        ticketNumber: lookupTicketNumber,
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
      const existingTicket = await EventCenterTicket.findOne({
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
    const ticket = await EventCenterTicket.findOne({ _id: id, buyer: userId })
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

    const ticket = await EventCenterTicket.findOne({
      ticketNumber: lookupTicketNumber,
    })
      .populate("buyer", "firstName surname email phoneNumber")
      .populate("eventCenter", "venueName location totalPrice bookingUnit");

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Booking pass not found." });
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

module.exports = {
  createTicket,
  verifyPayment,
  getMyTickets,
  validateTicket,
  verifyTicket,
  getTicketById,
};
