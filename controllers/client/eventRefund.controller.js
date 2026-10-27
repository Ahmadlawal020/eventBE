const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const EventRefund = require("../../models/client/eventRefund.schema");
const { NOTIFICATION_TYPES } = require("../../constants/notificationTypes");
const { queueNotices } = require("../../services/refundNotifications.service");

const isOwner = (event, userId) => String(event.createdBy) === String(userId);
const validId = (id) => mongoose.Types.ObjectId.isValid(id);

async function getMyRefunds(req, res) {
  const scope = {};
  for (const key of ["ticketId", "refundId"]) {
    if (req.query?.[key]) {
      if (!validId(req.query[key])) return res.status(400).json({ message: "Invalid refund identifier." });
      scope[key === "refundId" ? "_id" : key] = req.query[key];
    }
  }
  const refunds = await EventRefund.find({ buyer: req.user.id, ticketId: { $exists: true }, ...scope }).select("+bankDetails.accountNumber +bankDetails.bankCode").populate("eventId", "title lifecycle status").sort({ createdAt: -1 }).lean();
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
      "receipt.uploadedAt": null, "settlement.id": null,
      status: { $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER", "OVERDUE"] } },
    { $inc: { bankDetailsVersion: 1 }, $set: { bankDetails,
      status: "DUE_FROM_ORGANISER", bankDetailsSubmittedAt: new Date() },
      $unset: { markedPaidAt: 1, "receipt.uploadedAt": 1, pendingReceiptPublicId: 1 } },
    refund => ({
      key: `refund-details:${refund._id}:${refund.updatedAt?.getTime() || Date.now()}`,
      recipient: refund.organiser, sender: req.user.id, type: NOTIFICATION_TYPES.ORGANISER_REFUND_DUE,
      title: "Refund details received", message: "A buyer submitted or updated their cancellation refund bank details.",
      data: { refundId: String(refund._id), eventId: String(refund.eventId), screen: "OrganiserRefunds" },
    }),
  );
  if (!refund) return res.status(409).json({ success: false, message: "Bank details are locked while settlement is being prepared, after proof is uploaded, or when the refund is closed. Contact support for corrections." });
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
    const { organiserReference = "", settlementId } = req.body || {};
    if (typeof settlementId !== "string" || !settlementId)
      return res.status(409).json({ success: false, message: "Prepare settlement for this refund before recording payment." });
    if (typeof organiserReference !== "string" || organiserReference.length > 200) return res.status(400).json({ success: false, message: "Payment reference must be at most 200 characters." });
    const refund = await transitionRefund({
      _id: req.params.refundId, organiser: req.user.id, ticketId: { $type: "objectId" },
      status: { $in: ["DUE_FROM_ORGANISER", "OVERDUE"] },
      markedPaidAt: null,
      "bankDetails.accountName": { $regex: /\S/ },
      "bankDetails.accountNumber": { $regex: /^[0-9]{6,34}$/ },
      "bankDetails.bankCode": { $regex: /^[A-Za-z0-9-]{2,20}$/ },
      "settlement.id": settlementId, "receipt.settlementId": settlementId,
      $expr: { $eq: ["$settlement.bankDetailsVersion", "$bankDetailsVersion"] },
      "receipt.publicId": { $regex: /\S/ },
      "receipt.uploadedAt": { $type: "date" },
    }, { $set: {
      status: "MARKED_PAID", paidSettlementId: settlementId, organiserReference: organiserReference.trim(),
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
  }, { $set: { status: "CONFIRMED_BY_BUYER", confirmedAt: new Date(), "supportRequest.status": "RESOLVED", "managementCase.status": "RESOLVED", "managementCase.resolvedAt": new Date(), "managementCase.resolution": "Buyer confirmed receipt of the refund." } }, refund => ({
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

module.exports = { organiserBuyers, getMyRefunds, submitBankDetails, organiserRefunds, markRefundPaid, confirmRefund, disputeRefund };
