const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const EventBooking = require("../../models/client/eventBooking.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const TicketTransferRequest = require("../../models/client/ticketTransferRequest.schema");
const EventRefund = require("../../models/client/eventRefund.schema");
const { NOTIFICATION_TYPES } = require("../../constants/notificationTypes");
const { queueNotices, cancellationNotices } = require("../../services/refundNotifications.service");
const { ticketPriceMinor } = require("../../services/eventRefundAmount.service");

const isOwner = (event, userId) => String(event.createdBy) === String(userId);
const validId = (id) => mongoose.Types.ObjectId.isValid(id);

async function cancellationPreview(req, res) {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const event = await Event.findById(req.params.id).select("title createdBy status").lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    if (!isOwner(event, req.user.id)) return res.status(403).json({ success: false, message: "Only the original organiser can cancel this event." });

    const bookings = await EventBooking.find({ eventId: event._id, paymentStatus: "COMPLETED" })
      .select("subtotalAmount totalAmount items currency buyer").lean();
    const paid = bookings.filter((booking) => Number(booking.totalAmount || 0) > 0);
    const refundsByCurrency = paid.reduce((result, booking) => {
      const currency = booking.currency || "NGN";
      result[currency] = (result[currency] || 0) + ticketPriceMinor(booking);
      return result;
    }, {});
    const ticketCount = await UserEventTicket.countDocuments({ eventId: event._id, status: { $nin: ["CANCELLED", "REDEEMED"] } });
    return res.json({ success: true, data: {
      event: { id: event._id, title: event.title, status: event.status },
      paidOrders: paid.length,
      ticketCount,
      refundLiabilityMinorByCurrency: refundsByCurrency,
      note: "Refund liability is ticket price only. Munasaba platform fees are not refunded and Munasaba does not process these payments.",
    }});
  } catch (error) {
    console.error("[EVENT CANCELLATION PREVIEW]", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Could not calculate cancellation impact." });
  }
}

async function cancelEvent(req, res) {
  const { message, refundDueDays = 7, confirm } = req.body || {};
  if (confirm !== true) return res.status(400).json({ success: false, message: "Confirm cancellation before continuing." });
  if (typeof message !== "string" || !message.trim() || message.length > 1000) return res.status(400).json({ success: false, message: "A message to ticket holders between 1 and 1000 characters is required." });
  const days = Number(refundDueDays);
  if (!Number.isInteger(days) || days < 1 || days > 30) return res.status(400).json({ success: false, message: "Refund deadline must be between 1 and 30 days." });

  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const outcome = await mongoose.connection.transaction(async (session) => {
      const event = await Event.findById(req.params.id).session(session);
      if (!event) throw Object.assign(new Error("Event not found."), { statusCode: 404 });
      if (!isOwner(event, req.user.id)) throw Object.assign(new Error("Only the original organiser can cancel this event."), { statusCode: 403 });
      if (["CANCELLED", "COMPLETED"].includes(event.status)) throw Object.assign(new Error(`This event is already ${event.status.toLowerCase()}.`), { statusCode: 409 });

      const dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const bookings = await EventBooking.find({ eventId: event._id, paymentStatus: { $in: ["COMPLETED", "REFUNDED"] } }).session(session);
      const refundable = bookings.filter((booking) => booking.paymentStatus === "COMPLETED" && Number(booking.totalAmount || 0) > 0);
      const tickets = await UserEventTicket.find({ eventId: event._id }).session(session).lean();
      const { allocateTicketRefunds } = require("../../services/ticketRefundAllocation.service");
      const refundDocs = refundable.flatMap(booking => allocateTicketRefunds(booking, tickets, event, dueAt));
      if (refundDocs.length) await EventRefund.insertMany(refundDocs, { session, ordered: true });

      event.status = "CANCELLED";
      event.lifecycle = { cancellationMessage: message.trim(), cancelledAt: new Date(), cancelledBy: req.user.id, refundDueAt: dueAt };
      await event.save({ session });
      await UserEventTicket.updateMany(
        { eventId: event._id, status: { $nin: ["CANCELLED", "REDEEMED"] } },
        { $set: { status: "CANCELLED", invalidatedReason: "EVENT_CANCELLED", invalidatedAt: new Date() } },
        { session },
      );
      await TicketTransferRequest.updateMany(
        { ticketCategory: "USER_EVENT", status: "PENDING", ticketId: { $in: (await UserEventTicket.find({ eventId: event._id }).session(session).select("_id").lean()).map((ticket) => ticket._id) } },
        { $set: { status: "CANCELLED" } }, { session },
      );
      const ticketOwners = await UserEventTicket.distinct("owner", { eventId: event._id }).session(session);
      // Notify purchasers about cancellation too; refund access belongs to current holders.
      const refundBuyers = bookings.filter((booking) => booking.buyer).map((booking) => String(booking.buyer));
      const recipients = [...new Set([...ticketOwners.map(String), ...refundBuyers])];
      await queueNotices(cancellationNotices(event, recipients), session);
      return { event, dueAt, paidOrders: refundable.length, recipients };
    });

    return res.json({ success: true, message: "Event cancelled. Buyer notices are queued for delivery.", data: {
      paidOrders: outcome.paidOrders, refundDueAt: outcome.dueAt,
      notifications: { queued: outcome.recipients.length },
    } });
  } catch (error) {
    console.error("[CANCEL EVENT]", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Could not cancel event." });
  }
}

async function getMyRefunds(req, res) {
  const refunds = await EventRefund.find({ buyer: req.user.id, ticketId: { $exists: true } }).select("+bankDetails.accountNumber +bankDetails.bankCode").populate("eventId", "title lifecycle status").sort({ createdAt: -1 }).lean();
  return res.json({ success: true, data: refunds });
}

async function transitionRefund(filter, update, makeNotice) {
  return mongoose.connection.transaction(async session => {
    const refund = await EventRefund.findOneAndUpdate(filter, update, { new: true, runValidators: true, session });
    if (refund && makeNotice) await queueNotices([makeNotice(refund)], session);
    return refund;
  });
}

async function submitBankDetails(req, res) {
  let bankDetails;
  try { bankDetails = require("../../services/refundBankDetails.service").normalizeRefundBankDetails(req.body || {}); }
  catch (error) { return res.status(error.statusCode || 400).json({ success: false, message: error.message, field: error.field }); }
  const refund = await transitionRefund(
    { _id: req.params.refundId, buyer: req.user.id, ticketId: { $exists: true }, markedPaidAt: null,
      "receipt.uploadedAt": null,
      status: { $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER", "OVERDUE"] } },
    { $set: { bankDetails,
      status: "DUE_FROM_ORGANISER", bankDetailsSubmittedAt: new Date() },
      $unset: { markedPaidAt: 1, "receipt.uploadedAt": 1, pendingReceiptPublicId: 1 } },
    refund => ({
      key: `refund-details:${refund._id}:${refund.updatedAt?.getTime() || Date.now()}`,
      recipient: refund.organiser, sender: req.user.id, type: NOTIFICATION_TYPES.ORGANISER_REFUND_DUE,
      title: "Refund details received", message: "A buyer submitted or updated their cancellation refund bank details.",
      data: { refundId: String(refund._id), eventId: String(refund.eventId), screen: "OrganiserRefunds" },
    }),
  );
  if (!refund) return res.status(409).json({ success: false, message: "Bank details cannot be changed after payment proof is uploaded or the refund is closed." });
  return res.json({ success: true, data: refund });
}

async function organiserRefunds(req, res) {
  const event = await Event.findById(req.params.id).select("createdBy").lean();
  if (!event) return res.status(404).json({ success: false, message: "Event not found." });
  if (!isOwner(event, req.user.id)) return res.status(403).json({ success: false, message: "Only the original organiser can view these refunds." });
  const refunds = await EventRefund.find({ eventId: event._id }).select("+bankDetails.accountNumber +bankDetails.bankCode").populate("buyer", "firstName surname email").populate("ticketId", "ticketName ticketNumber").populate("bookingId", "items paymentReference").sort({ dueAt: 1 }).lean();
  return res.json({ success: true, data: refunds });
}

async function markRefundPaid(req, res) {
  try {
    const { organiserReference = "" } = req.body || {};
    if (typeof organiserReference !== "string" || organiserReference.length > 200) return res.status(400).json({ success: false, message: "Payment reference must be at most 200 characters." });
    const refund = await transitionRefund({
      _id: req.params.refundId, organiser: req.user.id, ticketId: { $exists: true },
      status: { $in: ["DUE_FROM_ORGANISER", "OVERDUE"] },
      markedPaidAt: { $exists: false },
      "bankDetails.accountName": { $exists: true, $ne: "" },
      "receipt.uploadedAt": { $exists: true },
    }, { $set: {
      status: "MARKED_PAID", organiserReference: organiserReference.trim(),
      markedPaidAt: new Date(), confirmationDueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } }, refund => ({
      key: `refund-paid:${refund._id}`, recipient: refund.buyer, sender: req.user.id,
      type: NOTIFICATION_TYPES.ORGANISER_REFUND_MARKED_PAID, title: "Organiser marked your refund as paid",
      message: "A payment receipt is available in your refund details. Confirm only after the money reaches your account.",
      data: { refundId: String(refund._id), screen: "RefundDetails" },
    }));
    if (!refund) return res.status(409).json({ success: false, message: "Upload a receipt for a refund with submitted bank details before marking it paid. Refresh if it was already paid." });
    return res.json({ success: true, data: refund });
  } catch (error) {
    return res.status(error.name === "CastError" ? 400 : 500).json({ success: false, message: "Could not record refund payment." });
  }
}

async function organiserBuyers(req, res) {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const event = await Event.findById(req.params.id).select("createdBy").lean();
    if (!event || !isOwner(event, req.user.id)) return res.status(404).json({ success: false, message: "Event not found." });
    const tickets = await UserEventTicket.find({ eventId: event._id })
      .populate("owner", "firstName surname email").sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: tickets.map(ticket => ({
      _id: ticket._id, buyer: ticket.owner, ticketNumber: ticket.ticketNumber, status: ticket.status,
      ticketKind: ticket.ticketSnapshot?.ticketType, priceAmount: ticket.ticketSnapshot?.price?.amount,
      transferred: Boolean(ticket.transferHistory?.length), createdAt: ticket.createdAt,
      items: [{ ticketId: ticket.ticketTypeId, name: ticket.ticketName, quantity: 1 }],
    })) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not load ticket buyers." });
  }
}

async function confirmRefund(req, res) {
  const refund = await transitionRefund({
    _id: req.params.refundId, buyer: req.user.id, ticketId: { $exists: true },
    $or: [{ status: "MARKED_PAID" }, { status: "OVERDUE", markedPaidAt: { $exists: true } }, { status: "DISPUTED" }],
  }, { $set: { status: "CONFIRMED_BY_BUYER", confirmedAt: new Date(), "managementCase.status": "RESOLVED", "managementCase.resolvedAt": new Date(), "managementCase.resolution": "Buyer confirmed receipt of the refund." } }, refund => ({
    key: `refund-confirmed:${refund._id}`, recipient: refund.organiser, sender: req.user.id,
    type: NOTIFICATION_TYPES.SYSTEM, title: "Buyer confirmed their refund",
    message: "The buyer confirmed receiving the cancellation refund.",
    data: { eventId: String(refund.eventId), refundId: String(refund._id), screen: "OrganiserRefunds" },
  }));
  if (!refund) return res.status(409).json({ success: false, message: "Refund is not ready for confirmation." });
  return res.json({ success: true, data: refund });
}

async function disputeRefund(req, res) {
  const reason = req.body?.reason ?? "Buyer reports that the direct refund was not received.";
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 1000) return res.status(400).json({ success: false, message: "Enter a dispute reason of 1-1000 characters." });
  const refund = await transitionRefund({
    _id: req.params.refundId, buyer: req.user.id, ticketId: { $exists: true },
    $or: [{ status: "MARKED_PAID" }, { status: "OVERDUE", markedPaidAt: { $exists: true } }],
  }, { $set: { status: "DISPUTED", disputeReason: reason.trim(), "managementCase.status": "OPEN" } }, refund => ({
    key: `refund-disputed:${refund._id}`, recipient: refund.organiser, sender: req.user.id,
    type: NOTIFICATION_TYPES.SYSTEM, title: "Buyer disputed a cancellation refund",
    message: "The buyer says they have not received the refund. Review the payment and contact support.",
    data: { eventId: String(refund.eventId), refundId: String(refund._id), screen: "OrganiserRefunds" },
  }));
  if (!refund) return res.status(409).json({ success: false, message: "Refund is not available for dispute." });
  return res.json({ success: true, data: refund });
}

module.exports = { organiserBuyers, cancellationPreview, cancelEvent, getMyRefunds, submitBankDetails, organiserRefunds, markRefundPaid, confirmRefund, disputeRefund };
