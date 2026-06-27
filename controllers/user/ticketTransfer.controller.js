const UserEventTicket = require("../../models/user/userEventTicket.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const TicketTransferRequest = require("../../models/user/ticketTransferRequest.schema");
const User = require("../../models/user/user.schema");
const Notification = require("../../models/user/notification.schema");
const { generateTicketNumber, generateQRPayload } = require("../../utils/qr");

// ============================================================================
// HELPER: Get ticket model and owner field by category
// ============================================================================
function getModelInfo(ticketCategory) {
  if (ticketCategory === "USER_EVENT") {
    return { Model: UserEventTicket, ownerField: "owner", prefix: "MNB", qrType: "EVENT" };
  }
  return { Model: EventCenterBooking, ownerField: "buyer", prefix: "MNS", qrType: "EVENT_CENTER" };
}

// ============================================================================
// HELPER: Validate ticket ownership and status for initiating transfer
// ============================================================================
async function validateTicketForTransfer(ticketId, ticketCategory, senderId) {
  const { Model, ownerField } = getModelInfo(ticketCategory);

  if (ticketCategory === "USER_EVENT") {
    const ticket = await Model.findOne({
      _id: ticketId,
      owner: senderId,
      status: "UNREDEEMED",
    }).populate("eventId", "title").lean();

    if (!ticket) {
      const exists = await Model.findById(ticketId).select("owner status").lean();
      if (!exists) return { error: { status: 404, message: "Ticket not found." } };
      if (String(exists.owner) !== senderId) return { error: { status: 403, message: "You do not own this ticket." } };
      return { error: { status: 400, message: `Cannot transfer a ticket with status "${exists.status}".` } };
    }

    const eventTitle = ticket.eventSnapshot?.title || ticket.eventId?.title || "an event";
    return { ticket, eventTitle };
  } else {
    const ticket = await Model.findOne({
      _id: ticketId,
      buyer: senderId,
      status: { $in: ["ACTIVE", "CONFIRMED"] },
    }).populate("eventCenter", "venueName").lean();

    if (!ticket) {
      const exists = await Model.findById(ticketId).select("buyer status").lean();
      if (!exists) return { error: { status: 404, message: "Booking not found." } };
      if (String(exists.buyer) !== senderId) return { error: { status: 403, message: "You do not own this booking." } };
      return { error: { status: 400, message: `Cannot transfer a booking with status "${exists.status}".` } };
    }

    const eventTitle = ticket.eventCenter?.venueName || "a venue";
    return { ticket, eventTitle };
  }
}

// ============================================================================
// INITIATE TRANSFER
// Creates a transfer request. Does NOT change ticket ownership.
// ============================================================================
const initiateTransfer = async (req, res) => {
  const senderId = req.user.id;
  const { ticketId, ticketCategory, recipientEmail } = req.body;

  if (!ticketId || !ticketCategory || !recipientEmail) {
    return res.status(400).json({
      success: false,
      message: "ticketId, ticketCategory, and recipientEmail are required.",
    });
  }

  if (!["USER_EVENT", "EVENT_CENTER"].includes(ticketCategory)) {
    return res.status(400).json({
      success: false,
      message: "ticketCategory must be USER_EVENT or EVENT_CENTER.",
    });
  }

  try {
    // 1. Look up recipient
    const recipient = await User.findOne({
      email: recipientEmail.toLowerCase().trim(),
    })
      .select("_id firstName surname email")
      .lean();

    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: "No registered user found with that email address.",
      });
    }

    if (String(recipient._id) === senderId) {
      return res.status(400).json({
        success: false,
        message: "You cannot transfer a ticket to yourself.",
      });
    }

    // 2. Fetch sender name
    const sender = await User.findById(senderId).select("firstName surname").lean();
    const senderName = `${sender?.firstName || ""} ${sender?.surname || ""}`.trim() || "Someone";

    // 3. Validate ticket
    const { ticket, eventTitle, error } = await validateTicketForTransfer(
      ticketId, ticketCategory, senderId
    );
    if (error) return res.status(error.status).json({ success: false, message: error.message });

    // 4. Check for existing pending request on this ticket
    const existingRequest = await TicketTransferRequest.findOne({
      ticketId,
      status: "PENDING",
    }).lean();

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        message: "There is already a pending transfer request for this ticket. Cancel it first before initiating a new one.",
      });
    }

    // 5. Create transfer request
    const transferRequest = await TicketTransferRequest.create({
      sender: senderId,
      recipient: recipient._id,
      ticketId,
      ticketCategory,
      status: "PENDING",
    });

    // 6. Notify recipient
    const recipientName = `${recipient.firstName || ""} ${recipient.surname || ""}`.trim();
    await Notification.create({
      recipient: recipient._id,
      sender: senderId,
      type: "TICKET_TRANSFER_REQUEST",
      title: "Ticket Transfer Request",
      message: `${senderName} wants to transfer a ticket for ${eventTitle} to you. Tap to review.`,
      referenceId: transferRequest._id,
    });

    res.status(201).json({
      success: true,
      message: `Transfer request sent to ${recipientName}. They will be notified to accept or decline.`,
      data: {
        requestId: transferRequest._id,
        recipient: { id: recipient._id, name: recipientName, email: recipient.email },
      },
    });
  } catch (error) {
    console.error("[INITIATE TRANSFER ERROR]", error);
    res.status(500).json({ success: false, message: "Server error initiating transfer." });
  }
};

// ============================================================================
// ACCEPT TRANSFER
// Recipient accepts — ownership transfers, new QR generated.
// ============================================================================
const acceptTransfer = async (req, res) => {
  const userId = req.user.id;
  const { requestId } = req.params;

  try {
    // 1. Find and atomically lock the request
    const request = await TicketTransferRequest.findOneAndUpdate(
      { _id: requestId, recipient: userId, status: "PENDING" },
      { status: "ACCEPTED" },
      { new: true }
    );

    if (!request) {
      const exists = await TicketTransferRequest.findById(requestId)
        .select("recipient status")
        .lean();
      if (!exists) return res.status(404).json({ success: false, message: "Transfer request not found." });
      if (String(exists.recipient) !== userId) return res.status(403).json({ success: false, message: "This request is not for you." });
      return res.status(400).json({ success: false, message: `Request is no longer pending (status: ${exists.status}).` });
    }

    // 2. Validate ticket still transferable
    const { Model, ownerField, prefix, qrType } = getModelInfo(request.ticketCategory);
    const statusFilter = request.ticketCategory === "USER_EVENT"
      ? { status: "UNREDEEMED" }
      : { status: { $in: ["ACTIVE", "CONFIRMED"] } };

    const ticket = await Model.findOne({
      _id: request.ticketId,
      [ownerField]: request.sender.toString(),
      ...statusFilter,
    }).lean();

    if (!ticket) {
      // Ticket no longer valid — revert request
      await TicketTransferRequest.findByIdAndUpdate(requestId, { status: "CANCELLED" });
      return res.status(400).json({
        success: false,
        message: "Ticket is no longer available for transfer. It may have been redeemed or cancelled.",
      });
    }

    // 3. Generate new ticket number and QR
    const newTicketNumber = generateTicketNumber(prefix);
    const entityId = request.ticketCategory === "USER_EVENT"
      ? ticket.eventId
      : ticket.eventCenter;
    const newQrPayload = generateQRPayload(newTicketNumber, entityId, qrType);

    // 4. Build update fields
    const updateFields = {
      [ownerField]: userId,
      ticketNumber: newTicketNumber,
      qrPayload: newQrPayload,
      $push: {
        transferHistory: {
          fromUser: request.sender,
          toUser: userId,
          transferredAt: new Date(),
          previousTicketNumber: ticket.ticketNumber,
        },
      },
    };

    // Update guestDetails for venue bookings
    if (request.ticketCategory !== "USER_EVENT") {
      const recipient = await User.findById(userId).select("firstName surname email phoneNumber").lean();
      if (recipient) {
        updateFields["guestDetails.fullName"] = `${recipient.firstName} ${recipient.surname}`.trim();
        updateFields["guestDetails.email"] = recipient.email;
        if (recipient.phoneNumber) {
          updateFields["guestDetails.phoneNumber"] = recipient.phoneNumber;
        }
      }
    }

    // 5. Atomic ticket update
    const updatedTicket = await Model.findOneAndUpdate(
      { _id: request.ticketId, [ownerField]: request.sender.toString(), ...statusFilter },
      updateFields,
      { new: true }
    );

    if (!updatedTicket) {
      await TicketTransferRequest.findByIdAndUpdate(requestId, { status: "CANCELLED" });
      return res.status(409).json({
        success: false,
        message: "Ticket state changed during acceptance. Please try again.",
      });
    }

    // 6. Notify sender
    const recipient = await User.findById(userId).select("firstName surname").lean();
    const recipientName = `${recipient?.firstName || ""} ${recipient?.surname || ""}`.trim();
    await Notification.create({
      recipient: request.sender,
      sender: userId,
      type: "TICKET_TRANSFER_ACCEPTED",
      title: "Transfer Accepted",
      message: `${recipientName} accepted your ticket transfer. The ticket has been transferred.`,
      referenceId: request._id,
    });

    res.status(200).json({
      success: true,
      message: "Ticket successfully transferred to you.",
      data: {
        ticketId: updatedTicket._id,
        newTicketNumber,
      },
    });
  } catch (error) {
    console.error("[ACCEPT TRANSFER ERROR]", error);
    res.status(500).json({ success: false, message: "Server error accepting transfer." });
  }
};

// ============================================================================
// DECLINE TRANSFER
// Recipient declines the transfer request.
// ============================================================================
const declineTransfer = async (req, res) => {
  const userId = req.user.id;
  const { requestId } = req.params;

  try {
    const request = await TicketTransferRequest.findOneAndUpdate(
      { _id: requestId, recipient: userId, status: "PENDING" },
      { status: "DECLINED" },
      { new: true }
    );

    if (!request) {
      const exists = await TicketTransferRequest.findById(requestId).select("recipient status").lean();
      if (!exists) return res.status(404).json({ success: false, message: "Transfer request not found." });
      if (String(exists.recipient) !== userId) return res.status(403).json({ success: false, message: "This request is not for you." });
      return res.status(400).json({ success: false, message: `Request is no longer pending (status: ${exists.status}).` });
    }

    // Notify sender
    const recipient = await User.findById(userId).select("firstName surname").lean();
    const recipientName = `${recipient?.firstName || ""} ${recipient?.surname || ""}`.trim();
    await Notification.create({
      recipient: request.sender,
      sender: userId,
      type: "TICKET_TRANSFER_DECLINED",
      title: "Transfer Declined",
      message: `${recipientName} declined your ticket transfer request.`,
      referenceId: request._id,
    });

    res.status(200).json({
      success: true,
      message: "Transfer request declined.",
    });
  } catch (error) {
    console.error("[DECLINE TRANSFER ERROR]", error);
    res.status(500).json({ success: false, message: "Server error declining transfer." });
  }
};

// ============================================================================
// CANCEL TRANSFER
// Sender cancels their pending transfer request.
// ============================================================================
const cancelTransfer = async (req, res) => {
  const senderId = req.user.id;
  const { requestId } = req.params;

  try {
    const request = await TicketTransferRequest.findOneAndDelete({
      _id: requestId,
      sender: senderId,
      status: "PENDING",
    });

    if (!request) {
      const exists = await TicketTransferRequest.findById(requestId).select("sender status").lean();
      if (!exists) return res.status(404).json({ success: false, message: "Transfer request not found." });
      if (String(exists.sender) !== senderId) return res.status(403).json({ success: false, message: "You did not initiate this transfer." });
      return res.status(400).json({ success: false, message: `Request is no longer pending (status: ${exists.status}).` });
    }

    // Clean up the notification sent to recipient
    await Notification.deleteOne({
      recipient: request.recipient,
      type: "TICKET_TRANSFER_REQUEST",
      referenceId: request._id,
    });

    res.status(200).json({
      success: true,
      message: "Transfer request cancelled.",
    });
  } catch (error) {
    console.error("[CANCEL TRANSFER ERROR]", error);
    res.status(500).json({ success: false, message: "Server error cancelling transfer." });
  }
};

// ============================================================================
// GET PENDING TRANSFERS (RECEIVED)
// Returns pending transfer requests for the current user (as recipient).
// Checks at query time if event has started — treats as expired if so.
// ============================================================================
const getPendingTransfers = async (req, res) => {
  const userId = req.user.id;

  try {
    const requests = await TicketTransferRequest.find({
      recipient: userId,
      status: "PENDING",
    })
      .populate("sender", "firstName surname profilePicture")
      .sort({ createdAt: -1 })
      .lean();

    // Enrich with ticket info and check expiry
    const enriched = [];
    const expiredIds = [];

    for (const request of requests) {
      let ticket;
      let eventTitle = "";
      let ticketName = "";
      let schedule = null;

      if (request.ticketCategory === "USER_EVENT") {
        ticket = await UserEventTicket.findById(request.ticketId)
          .select("eventSnapshot ticketSnapshot ticketName status")
          .lean();
        eventTitle = ticket?.eventSnapshot?.title || "Event";
        ticketName = ticket?.ticketSnapshot?.name || ticket?.ticketName || "Ticket";
        schedule = ticket?.eventSnapshot?.schedule;
      } else {
        ticket = await EventCenterBooking.findById(request.ticketId)
          .select("eventCenter selectedDates status")
          .populate("eventCenter", "venueName")
          .lean();
        eventTitle = ticket?.eventCenter?.venueName || "Venue";
        ticketName = "Venue Booking";
        schedule = ticket?.selectedDates?.[0]
          ? { startDate: ticket.selectedDates[0].date }
          : null;
      }

      // Check if event has started — treat as expired
      if (schedule?.startDate && new Date(schedule.startDate) < new Date()) {
        expiredIds.push(request._id);
        continue;
      }

      // Check if ticket still valid
      if (!ticket || ticket.status === "REDEEMED" || ticket.status === "CANCELLED") {
        expiredIds.push(request._id);
        continue;
      }

      enriched.push({
        ...request,
        eventTitle,
        ticketName,
        schedule,
      });
    }

    // Mark expired requests
    if (expiredIds.length > 0) {
      await TicketTransferRequest.updateMany(
        { _id: { $in: expiredIds } },
        { status: "CANCELLED" }
      );
    }

    res.status(200).json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    console.error("[GET PENDING TRANSFERS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching pending transfers." });
  }
};

// ============================================================================
// GET SENT TRANSFER REQUESTS
// Returns pending transfer requests initiated by the current user.
// ============================================================================
const getSentTransferRequests = async (req, res) => {
  const senderId = req.user.id;

  try {
    const requests = await TicketTransferRequest.find({
      sender: senderId,
      status: "PENDING",
    })
      .populate("recipient", "firstName surname email profilePicture")
      .sort({ createdAt: -1 })
      .lean();

    // Enrich with ticket info
    const enriched = [];
    for (const request of requests) {
      let eventTitle = "";
      let ticketName = "";

      if (request.ticketCategory === "USER_EVENT") {
        const ticket = await UserEventTicket.findById(request.ticketId)
          .select("eventSnapshot ticketSnapshot ticketName")
          .lean();
        eventTitle = ticket?.eventSnapshot?.title || "Event";
        ticketName = ticket?.ticketSnapshot?.name || ticket?.ticketName || "Ticket";
      } else {
        const ticket = await EventCenterBooking.findById(request.ticketId)
          .select("eventCenter")
          .populate("eventCenter", "venueName")
          .lean();
        eventTitle = ticket?.eventCenter?.venueName || "Venue";
        ticketName = "Venue Booking";
      }

      enriched.push({ ...request, eventTitle, ticketName });
    }

    res.status(200).json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    console.error("[GET SENT TRANSFERS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching sent transfers." });
  }
};

// ============================================================================
// GET TRANSFER HISTORY
// Returns the transfer audit trail for a ticket.
// ============================================================================
const getTransferHistory = async (req, res) => {
  const userId = req.user.id;
  const { ticketId } = req.params;
  const { ticketCategory } = req.query;

  if (!ticketCategory || !["USER_EVENT", "EVENT_CENTER"].includes(ticketCategory)) {
    return res.status(400).json({
      success: false,
      message: "ticketCategory query param is required (USER_EVENT or EVENT_CENTER).",
    });
  }

  try {
    const { Model, ownerField } = getModelInfo(ticketCategory);

    const ticket = await Model.findOne({
      _id: ticketId,
      $or: [
        { [ownerField]: userId },
        { "transferHistory.fromUser": userId },
        { "transferHistory.toUser": userId },
      ],
    })
      .select("transferHistory ticketNumber")
      .populate("transferHistory.fromUser", "firstName surname email")
      .populate("transferHistory.toUser", "firstName surname email")
      .lean();

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found." });
    }

    res.status(200).json({
      success: true,
      data: {
        currentTicketNumber: ticket.ticketNumber,
        transfers: ticket.transferHistory || [],
      },
    });
  } catch (error) {
    console.error("[GET TRANSFER HISTORY ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching transfer history." });
  }
};

// ============================================================================
// GET TRANSFER REQUEST DETAILS
// Returns details of a specific transfer request (for the review screen).
// ============================================================================
const getTransferRequestDetails = async (req, res) => {
  const userId = req.user.id;
  const { requestId } = req.params;

  try {
    const request = await TicketTransferRequest.findOne({
      _id: requestId,
      $or: [{ recipient: userId }, { sender: userId }],
    })
      .populate("sender", "firstName surname email profilePicture")
      .populate("recipient", "firstName surname email profilePicture")
      .lean();

    if (!request) {
      return res.status(404).json({ success: false, message: "Transfer request not found." });
    }

    // Enrich with ticket info
    let ticket;
    let eventTitle = "";
    let ticketName = "";
    let ticketDetails = {};

    if (request.ticketCategory === "USER_EVENT") {
      ticket = await UserEventTicket.findById(request.ticketId)
        .select("eventSnapshot ticketSnapshot ticketName ticketNumber status")
        .lean();
      eventTitle = ticket?.eventSnapshot?.title || "Event";
      ticketName = ticket?.ticketSnapshot?.name || ticket?.ticketName || "Ticket";
      ticketDetails = {
        schedule: ticket?.eventSnapshot?.schedule,
        location: ticket?.eventSnapshot?.location,
        coverImage: ticket?.eventSnapshot?.coverImage,
        price: ticket?.ticketSnapshot?.price,
        ticketNumber: ticket?.ticketNumber,
        status: ticket?.status,
      };
    } else {
      ticket = await EventCenterBooking.findById(request.ticketId)
        .select("eventCenter selectedDates ticketNumber status totalPrice")
        .populate("eventCenter", "venueName images location")
        .lean();
      eventTitle = ticket?.eventCenter?.venueName || "Venue";
      ticketName = "Venue Booking";
      ticketDetails = {
        schedule: ticket?.selectedDates?.[0]
          ? { startDate: ticket.selectedDates[0].date }
          : null,
        location: ticket?.eventCenter?.location,
        coverImage: ticket?.eventCenter?.images?.[0]?.url,
        price: ticket?.totalPrice,
        ticketNumber: ticket?.ticketNumber,
        status: ticket?.status,
      };
    }

    res.status(200).json({
      success: true,
      data: {
        ...request,
        eventTitle,
        ticketName,
        ticketDetails,
      },
    });
  } catch (error) {
    console.error("[GET TRANSFER REQUEST DETAILS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching request details." });
  }
};

module.exports = {
  initiateTransfer,
  acceptTransfer,
  declineTransfer,
  cancelTransfer,
  getPendingTransfers,
  getSentTransferRequests,
  getTransferHistory,
  getTransferRequestDetails,
};
