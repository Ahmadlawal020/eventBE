const UserEventTicket = require("../../models/user/userEventTicket.schema");
const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const crypto = require("crypto");

const QR_SECRET = process.env.QR_SIGNING_SECRET || "mnb-default-secret-change-in-production";

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

/**
 * Verify staff permissions for scanning tickets for a specific listing
 */
const checkStaffScannerPermission = async (staffId, listingId, listingType) => {
  const staffInvite = await StaffInvitation.findOne({
    staff: staffId,
    "listings.listingId": listingId,
    status: "ACCEPTED",
  });

  if (!staffInvite) {
    return { hasPermission: false, message: "You are not assigned to this listing." };
  }

  const hasScanPermission = staffInvite.permissions.includes("SCAN_TICKET");
  if (!hasScanPermission) {
    return { hasPermission: false, message: "You do not have permission to scan tickets for this listing." };
  }

  // Ensure listingType matches the assignment
  const listingEntry = staffInvite.listings.find((l) => l.listingId.toString() === listingId);
  if (!listingEntry) {
    return { hasPermission: false, message: "Listing assignment not found." };
  }

  const assignedType = listingEntry.listingType.toLowerCase() === "event" ? "event" : "event-center";
  const requestedType = listingType.toLowerCase() === "event" ? "event" : "event-center";

  if (assignedType !== requestedType) {
    return { hasPermission: false, message: "Listing type mismatch." };
  }

  return { hasPermission: true };
};

/**
 * Verify a ticket (Non-destructive lookup for Staff)
 */
const verifyTicketStaff = async (req, res) => {
  const { listingId, listingType } = req.params;
  const { ticketNumber, qrPayload } = req.body;
  const staffId = req.user.id;

  try {
    const permCheck = await checkStaffScannerPermission(staffId, listingId, listingType);
    if (!permCheck.hasPermission) {
      return res.status(403).json({ success: false, message: permCheck.message });
    }

    let lookupTicketNumber = ticketNumber;

    if (qrPayload) {
      const { valid, data } = verifyQRPayload(qrPayload);
      if (!valid) {
        return res.status(400).json({ success: false, message: "Invalid or tampered QR code." });
      }
      lookupTicketNumber = data.tn;

      // Make sure the QR code belongs to this listing
      const payloadListingId = data.eid || data.ecid;
      if (payloadListingId && payloadListingId !== listingId) {
        return res.status(400).json({ success: false, message: "This ticket does not belong to the currently active listing." });
      }
    }

    if (!lookupTicketNumber) {
      return res.status(400).json({ success: false, message: "Ticket number required." });
    }

    if (listingType === "event") {
      const ticket = await UserEventTicket.findOne({ ticketNumber: lookupTicketNumber })
        .populate("owner", "firstName surname email phoneNumber")
        .populate("eventId", "title");

      if (!ticket) {
        return res.status(404).json({ success: false, message: "Ticket not found." });
      }

      if (ticket.eventId._id.toString() !== listingId) {
        return res.status(400).json({ success: false, message: "This ticket does not belong to the currently active event." });
      }

      return res.status(200).json({
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
          type: "EVENT"
        }
      });
    } else if (listingType === "event-center") {
      const ticket = await EventCenterTicket.findOne({ ticketNumber: lookupTicketNumber })
        .populate("buyer", "firstName surname email phoneNumber")
        .populate("eventCenter", "venueName");

      if (!ticket) {
        return res.status(404).json({ success: false, message: "Booking pass not found." });
      }

      if (ticket.eventCenter._id.toString() !== listingId) {
        return res.status(400).json({ success: false, message: "This booking pass does not belong to the currently active event center." });
      }

      return res.status(200).json({
        success: true,
        data: {
          ticketNumber: ticket.ticketNumber,
          guestName: ticket.buyer ? `${ticket.buyer.firstName} ${ticket.buyer.surname}` : ticket.guestDetails?.fullName || "Guest",
          guestEmail: ticket.buyer?.email || ticket.guestDetails?.email,
          guestPhone: ticket.buyer?.phoneNumber || ticket.guestDetails?.phoneNumber,
          venueName: ticket.eventCenter?.venueName,
          status: ticket.status,
          paymentStatus: ticket.paymentStatus,
          isCheckedIn: ticket.checkIn?.isCheckedIn,
          checkedInAt: ticket.checkIn?.checkedInAt,
          type: "EVENT_CENTER"
        }
      });
    } else {
      return res.status(400).json({ success: false, message: "Invalid listing type." });
    }
  } catch (error) {
    console.error("[STAFF VERIFY TICKET ERROR]", error);
    res.status(500).json({ success: false, message: "Server error during verification." });
  }
};

/**
 * Validate and Check-in a ticket (Destructive operation for Staff)
 */
const validateTicketStaff = async (req, res) => {
  const { listingId, listingType } = req.params;
  const { ticketNumber, qrPayload } = req.body;
  const staffId = req.user.id;

  try {
    const permCheck = await checkStaffScannerPermission(staffId, listingId, listingType);
    if (!permCheck.hasPermission) {
      return res.status(403).json({ success: false, message: permCheck.message });
    }

    let lookupTicketNumber = ticketNumber;

    if (qrPayload) {
      const { valid, data } = verifyQRPayload(qrPayload);
      if (!valid) {
        return res.status(400).json({ success: false, message: "Invalid or tampered QR code. This ticket may be forged." });
      }
      lookupTicketNumber = data.tn;

      // Make sure the QR code belongs to this listing
      const payloadListingId = data.eid || data.ecid;
      if (payloadListingId && payloadListingId !== listingId) {
        return res.status(400).json({ success: false, message: "This ticket does not belong to the currently active listing." });
      }
    }

    if (!lookupTicketNumber) {
      return res.status(400).json({ success: false, message: "Ticket number or QR payload is required." });
    }

    if (listingType === "event") {
      const ticket = await UserEventTicket.findOneAndUpdate(
        {
          ticketNumber: lookupTicketNumber,
          eventId: listingId,
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
        const existingTicket = await UserEventTicket.findOne({
          ticketNumber: lookupTicketNumber,
        }).select("status redeemedAt ticketName eventId").lean();

        if (!existingTicket) {
          return res.status(404).json({ success: false, message: "Ticket not found. Please check the code and try again." });
        }

        if (existingTicket.eventId.toString() !== listingId) {
          return res.status(400).json({ success: false, message: "This ticket does not belong to the currently active event." });
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
          return res.status(400).json({ success: false, message: "This ticket has been cancelled and cannot be used for entry." });
        }

        return res.status(400).json({ success: false, message: `Ticket status: ${existingTicket.status}` });
      }

      res.status(200).json({
        success: true,
        message: "✅ Ticket validated — Welcome to the event!",
        data: {
          ticketNumber: ticket.ticketNumber,
          ticketName: ticket.ticketName,
          ownerName: ticket.owner ? `${ticket.owner.firstName} ${ticket.owner.surname}` : "Guest",
          eventTitle: ticket.eventSnapshot?.title,
          checkedInAt: ticket.checkIn?.checkedInAt,
        },
      });

    } else if (listingType === "event-center") {
      const ticket = await EventCenterTicket.findOneAndUpdate(
        {
          ticketNumber: lookupTicketNumber,
          eventCenter: listingId,
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
        { new: true }
      )
      .populate("buyer", "firstName surname email")
      .populate("eventCenter", "venueName");

      if (!ticket) {
        const existingTicket = await EventCenterTicket.findOne({
          ticketNumber: lookupTicketNumber,
        }).select("status checkIn guestDetails eventCenter").lean();

        if (!existingTicket) {
          return res.status(404).json({ success: false, message: "Booking pass not found. Please check the code and try again." });
        }

        if (existingTicket.eventCenter.toString() !== listingId) {
          return res.status(400).json({ success: false, message: "This booking pass does not belong to the currently active event center." });
        }

        if (existingTicket.checkIn?.isCheckedIn) {
          return res.status(409).json({
            success: false,
            message: "⚠️ DUPLICATE ENTRY — This booking pass has already been used.",
            data: {
              checkedInAt: existingTicket.checkIn.checkedInAt,
              guestName: existingTicket.guestDetails?.fullName,
            },
          });
        }

        if (existingTicket.status === "CANCELLED") {
          return res.status(400).json({ success: false, message: "This booking has been cancelled." });
        }

        return res.status(400).json({ success: false, message: `Booking status: ${existingTicket.status}` });
      }

      res.status(200).json({
        success: true,
        message: "✅ Booking pass validated — Welcome!",
        data: {
          ticketNumber: ticket.ticketNumber,
          guestName: ticket.buyer ? `${ticket.buyer.firstName} ${ticket.buyer.surname}` : ticket.guestDetails?.fullName || "Guest",
          venueName: ticket.eventCenter?.venueName,
          checkedInAt: ticket.checkIn?.checkedInAt,
        },
      });
    } else {
      return res.status(400).json({ success: false, message: "Invalid listing type." });
    }
  } catch (error) {
    console.error("[STAFF VALIDATE TICKET ERROR]", error);
    res.status(500).json({ success: false, message: "Server error during ticket validation." });
  }
};

module.exports = {
  verifyTicketStaff,
  validateTicketStaff,
};
