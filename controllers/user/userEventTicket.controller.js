const UserEventTicket = require("../../models/user/userEventTicket.schema");
const Ticket = require("../../models/user/eventTicketType.schema");
const Event = require("../../models/user/event.schema");
const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const { generateTicketNumber, generateQRPayload, verifyQRPayload } = require("../../utils/qr");

/**
 * Check if a user is authorized to scan/verify tickets for an event.
 * Owner: always has access
 * Co-organiser: SCAN_TICKET or ALL_ACCESS
 * Staff: SCAN_TICKET
 */
async function authorizeScanAccess(userId, eventId) {
  const event = await Event.findById(eventId).select("createdBy").lean();
  if (!event) return { authorized: false, error: "Event not found." };

  if (String(event.createdBy) === userId) return { authorized: true };

  const coOrganiserInvite = await CoOrganiserInvitation.findOne({
    coOrganiser: userId,
    host: event.createdBy,
    status: "ACCEPTED",
    "listings.listingId": event._id,
    permissions: { $in: ["SCAN_TICKET", "ALL_ACCESS"] },
  }).lean();
  if (coOrganiserInvite) return { authorized: true };

  const staffInvite = await StaffInvitation.findOne({
    staff: userId,
    organiser: event.createdBy,
    status: "ACCEPTED",
    "listings.listingId": event._id,
    permissions: "SCAN_TICKET",
  }).lean();
  if (staffInvite) return { authorized: true };

  return { authorized: false, error: "Not authorized to scan tickets for this event." };
}

// ============================================================================
// GET MY TICKETS
// ============================================================================
const getMyTickets = async (req, res) => {
  const userId = req.user.id;

  try {
    const tickets = await UserEventTicket.find({ owner: userId })
      .populate("eventId", "title coverImage startDateTime endDateTime venue")
      .populate("ticketTypeId", "name price")
      .sort({ createdAt: -1 })
      .lean(); // .lean() for read-only performance

    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    console.error("[GET MY TICKETS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching tickets" });
  }
};

// ============================================================================
// GET TICKET DETAILS
// ============================================================================
const getTicketDetails = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const ticket = await UserEventTicket.findOne({ _id: id, owner: userId })
      .populate("eventId")
      .populate("ticketTypeId")
      .populate("bookingId");

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    console.error("[GET TICKET DETAILS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching ticket details" });
  }
};

// ============================================================================
// CREATE TICKETS FOR BOOKING
// Called internally after successful payment verification.
// Designed for high throughput — batches DB writes, minimizes round trips.
// ============================================================================
const createTicketsForBooking = async (booking) => {
  try {
    const userEventTickets = [];

    // 1. Fetch Event for Snapshot (single DB call)
    const event = await Event.findById(booking.eventId)
      .populate("createdBy", "firstName surname email phoneNumber")
      .lean();
    if (!event) throw new Error("Event not found for snapshotting");

    const eventSnapshot = {
      title: event.title,
      shortDescription: event.shortDescription,
      coverImage: event.images?.[0]?.url || "",
      eventType: event.eventType,
      organiser: {
        name: `${event.createdBy?.firstName || ""} ${event.createdBy?.surname || ""}`.trim() || "Munasaba Organiser",
        email: event.createdBy?.email || "",
        phoneNumber: event.createdBy?.phoneNumber || "",
      },
      location: {
        addressString: event.location?.addressString || "",
        city: event.location?.city || "",
        state: event.location?.state || "",
        country: event.location?.country || "",
        coordinates: {
          latitude: event.location?.coordinates?.latitude,
          longitude: event.location?.coordinates?.longitude,
        },
      },
      schedule: {
        startDate: event.schedule?.from,
        endDate: event.schedule?.to,
      },
      arrivalGuide: {
        notes: event.arrivalGuide?.notes,
        parking: event.arrivalGuide?.parking,
        checkInInstructions: event.arrivalGuide?.checkInInstructions,
      },
    };

    // 2. Batch-fetch all ticket types in one query (avoids N+1)
    const ticketTypeIds = booking.items.map((item) => item.ticketId);
    const ticketTypes = await Ticket.find({ _id: { $in: ticketTypeIds } }).lean();
    const ticketTypeMap = {};
    ticketTypes.forEach((tt) => {
      ticketTypeMap[tt._id.toString()] = tt;
    });

    // 3. Build all ticket documents
    for (const item of booking.items) {
      const ticketType = ticketTypeMap[item.ticketId.toString()];
      if (!ticketType) continue;

      // soldQuantity is already atomically incremented at booking creation time.
      // No additional inventory update needed here.

      const ticketSnapshot = {
        name: ticketType.name,
        description: ticketType.description,
        additionalInstruction: ticketType.additionalInstruction,
        ticketType: ticketType.ticketType,
        price: {
          amount: (item.pricePerUnit || 0) / 100,
          currency: ticketType.currency?.code || "NGN",
          symbol: ticketType.currency?.symbol || "₦",
        },
      };

      // Create N individual tickets based on quantity
      for (let i = 0; i < item.quantity; i++) {
        const ticketNumber = generateTicketNumber();
        const qrPayload = generateQRPayload(ticketNumber, booking.eventId, "EVENT");

        userEventTickets.push({
          bookingId: booking._id,
          eventId: booking.eventId,
          ticketTypeId: item.ticketId,
          owner: booking.buyer,
          ticketName: item.name,
          ticketNumber,
          qrPayload,
          status: "UNREDEEMED",
          eventSnapshot,
          ticketSnapshot,
        });
      }
    }

    // 4. Execute bulk insert for tickets
    const savedTickets = userEventTickets.length > 0
      ? await UserEventTicket.insertMany(userEventTickets, { ordered: false })
      : [];

    return savedTickets;
  } catch (error) {
    console.error("[CREATE TICKETS FOR BOOKING ERROR]", error);
    throw error;
  }
};

// ============================================================================
// VALIDATE TICKET (FOR ENTRY CONTROL)
// Uses atomic findOneAndUpdate to prevent race conditions when
// multiple scanners hit the same ticket simultaneously.
// Supports both QR payload (signed) and plain ticket number (manual).
// ============================================================================
const validateTicket = async (req, res) => {
  const { ticketNumber, qrPayload } = req.body;
  const staffId = req.user.id;

  try {
    let lookupTicketNumber = ticketNumber;

    // If QR payload is provided, verify signature first (tamper-proofing)
    if (qrPayload) {
      const { valid, data } = verifyQRPayload(qrPayload);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: "Invalid or tampered QR code. This ticket may be forged.",
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

    // Ownership check: verify caller is authorised to scan for this event
    const existingTicket = await UserEventTicket.findOne({ ticketNumber: lookupTicketNumber })
      .select("eventId")
      .lean();

    if (!existingTicket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found. Please check the code and try again.",
      });
    }

    const auth = await authorizeScanAccess(req.user.id, existingTicket.eventId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    // Atomic update: find UNREDEEMED ticket and mark as REDEEMED in one operation.
    // This prevents race conditions — only the first scanner wins.
    const ticket = await UserEventTicket.findOneAndUpdate(
      {
        ticketNumber: lookupTicketNumber,
        status: "UNREDEEMED",
      },
      {
        $set: {
          status: "REDEEMED",
          redeemedAt: new Date(),
          redeemedBy: staffId,
          "checkIn.isCheckedIn": true,
          "checkIn.checkedInAt": new Date(),
          "checkIn.checkedInBy": staffId,
          "checkIn.method": qrPayload ? "QR" : "MANUAL",
        },
      },
      { new: true }
    ).populate("owner", "firstName surname email");

    if (!ticket) {
      // Check why it failed — ticket doesn't exist, or already redeemed?
      const existingTicket = await UserEventTicket.findOne({
        ticketNumber: lookupTicketNumber,
      }).select("status redeemedAt ticketName").lean();

      if (!existingTicket) {
        return res.status(404).json({
          success: false,
          message: "Ticket not found. Please check the code and try again.",
        });
      }

      if (existingTicket.status === "REDEEMED") {
        return res.status(409).json({
          success: false,
          message: "⚠️ DUPLICATE ENTRY — This ticket has already been used.",
          data: {
            redeemedAt: existingTicket.redeemedAt,
            ticketName: existingTicket.ticketName,
          },
        });
      }

      if (existingTicket.status === "CANCELLED") {
        return res.status(400).json({
          success: false,
          message: "This ticket has been cancelled and cannot be used for entry.",
        });
      }

      return res.status(400).json({
        success: false,
        message: `Ticket status: ${existingTicket.status}`,
      });
    }

    // Success — entry granted
    res.status(200).json({
      success: true,
      message: "✅ Ticket validated — Welcome to the event!",
      data: {
        ticketNumber: ticket.ticketNumber,
        ticketName: ticket.ticketName,
        ownerName: ticket.owner
          ? `${ticket.owner.firstName} ${ticket.owner.surname}`
          : "Guest",
        eventTitle: ticket.eventSnapshot?.title,
        checkedInAt: ticket.checkIn?.checkedInAt,
      },
    });
  } catch (error) {
    console.error("[VALIDATE TICKET ERROR]", error);
    res.status(500).json({
      success: false,
      message: "Server error during ticket validation.",
    });
  }
};

// ============================================================================
// GET EVENT CHECK-IN STATS (Analytics for organisers)
// ============================================================================
const getEventCheckInStats = async (req, res) => {
  const { eventId } = req.params;

  try {
    // Authorization check: only event owner/co-organiser/staff can view stats
    const auth = await authorizeScanAccess(req.user.id, eventId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const [total, redeemed, unredeemed, cancelled] = await Promise.all([
      UserEventTicket.countDocuments({ eventId }),
      UserEventTicket.countDocuments({ eventId, status: "REDEEMED" }),
      UserEventTicket.countDocuments({ eventId, status: "UNREDEEMED" }),
      UserEventTicket.countDocuments({ eventId, status: "CANCELLED" }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        redeemed,
        unredeemed,
        cancelled,
        checkInRate: total > 0 ? ((redeemed / total) * 100).toFixed(1) + "%" : "0%",
      },
    });
  } catch (error) {
    console.error("[CHECK-IN STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching stats" });
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
        return res.status(400).json({ success: false, message: "Invalid or tampered QR code." });
      }
      lookupTicketNumber = data.tn;
    }

    if (!lookupTicketNumber) {
      return res.status(400).json({ success: false, message: "Ticket number required." });
    }

    const ticket = await UserEventTicket.findOne({ ticketNumber: lookupTicketNumber })
      .populate("owner", "firstName surname email phoneNumber")
      .populate("eventId", "title coverImage startDateTime venue location")
      .populate("ticketTypeId", "name price");

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found." });
    }

    const auth = await authorizeScanAccess(req.user.id, ticket.eventId?._id || ticket.eventId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    res.status(200).json({
      success: true,
      data: {
        ticketNumber: ticket.ticketNumber,
        ticketName: ticket.ticketName,
        guestName: ticket.owner ? `${ticket.owner.firstName} ${ticket.owner.surname}` : "Guest",
        guestEmail: ticket.owner?.email,
        guestPhone: ticket.owner?.phoneNumber,
        eventTitle: ticket.eventSnapshot?.title || ticket.eventId?.title,
        status: ticket.status,
        isCheckedIn: ticket.checkIn?.isCheckedIn,
        checkedInAt: ticket.checkIn?.checkedInAt,
        price: ticket.ticketSnapshot?.price || ticket.ticketTypeId?.price,
        type: "EVENT"
      }
    });
  } catch (error) {
    console.error("[VERIFY TICKET ERROR]", error);
    res.status(500).json({ success: false, message: "Server error during verification." });
  }
};

module.exports = {
  getMyTickets,
  getTicketDetails,
  createTicketsForBooking,
  validateTicket,
  verifyTicket,
  getEventCheckInStats,
};
