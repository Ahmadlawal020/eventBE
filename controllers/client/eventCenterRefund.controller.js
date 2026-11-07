const mongoose = require("mongoose");
const EventCenterRefund = require("../../models/client/eventCenterRefund.schema");
const { NOTIFICATION_TYPES } = require("../../constants/notificationTypes");
const { queueNotices } = require("../../services/eventCenterRefundNotifications.service");

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

async function getMyRefunds(req, res) {
  const scope = {};
  for (const key of ["ticketId", "refundId"]) {
    if (req.query?.[key]) {
      if (!validId(req.query[key])) return res.status(400).json({ message: "Invalid refund identifier." });
      scope[key === "refundId" ? "_id" : key] = req.query[key];
    }
  }
  const refunds = await EventCenterRefund.find({ buyer: req.user.id, ticketId: { $exists: true }, ...scope }).select("+bankDetails.accountNumber +bankDetails.bankCode").populate("eventCenterId", "venueName status").sort({ createdAt: -1 }).lean();
  return res.json({ success: true, data: refunds });
}

async function transitionRefund(filter, update, makeNotice) {
  return mongoose.connection.transaction(async session => {
    const refund = await EventCenterRefund.findOneAndUpdate(filter, update, { new: true, runValidators: true, session });
    if (refund && makeNotice) await queueNotices([makeNotice(refund)], session);
    return refund;
  });
}

async function submitBankDetails(req, res) {
  let bankDetails;
  try { bankDetails = require("../../services/eventCenterRefundBankDetails.service").normalizeRefundBankDetails(req.body || {}); }
  catch (error) { return res.status(error.statusCode || 400).json({ success: false, message: error.message, field: error.field }); }
  const refund = await transitionRefund(
    { _id: req.params.refundId, buyer: req.user.id, ticketId: { $exists: true }, markedPaidAt: null,
      "receipt.uploadedAt": null, "settlement.id": null, "installments.0": { $exists: false },
      status: { $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER", "OVERDUE"] } },
    { $inc: { bankDetailsVersion: 1 }, $set: { bankDetails,
      status: "DUE_FROM_ORGANISER", bankDetailsSubmittedAt: new Date() },
      $unset: { markedPaidAt: 1, "receipt.uploadedAt": 1, pendingReceiptPublicId: 1 } },
    refund => ({
      key: `refund-details:${refund._id}:${refund.updatedAt?.getTime() || Date.now()}`,
      recipient: refund.organiser, sender: req.user.id, type: NOTIFICATION_TYPES.ORGANISER_REFUND_DUE,
      title: "Refund details received", message: "A buyer submitted or updated their cancellation refund bank details.",
      data: { refundId: String(refund._id), bookingId: String(refund.bookingId), screen: "OrganiserVenueRefund" },
    }),
  );
  if (!refund) return res.status(409).json({ success: false, message: "Bank details are locked while settlement is being prepared, after proof is uploaded, or when the refund is closed. Contact support for corrections." });
  return res.json({ success: true, data: refund });
}

async function markRefundPaid(req, res) {
  try {
    const data = await require("../../services/venueRefundInstallments.service").markPaid(req.params.refundId, req.user.id, { organiserReference: "", ...req.body });
    const safe = data.toJSON(); delete safe.managementCase;
    res.json({ success: true, data: safe });
  } catch (e) { res.status(e.status || 500).json({ message: e.status ? e.message : "Could not record refund payment." }); }
}
async function confirmRefund(req, res) {
  try {
    const data = await require("../../services/venueRefundInstallments.service").confirm(req.params.refundId, req.user.id, req.body?.settlementId);
    const safe = data.toJSON(); delete safe.managementCase;
    res.json({ success: true, data: safe });
  } catch (e) { res.status(e.status || 500).json({ message: e.status ? e.message : "Could not confirm refund payment." }); }
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
    data: { bookingId: String(refund.bookingId), refundId: String(refund._id), screen: "OrganiserVenueRefund" },
  }));
  if (!refund) return res.status(409).json({ success: false, message: "Refund is not available for dispute." });
  return res.json({ success: true, data: refund });
}

module.exports = { getMyRefunds, submitBankDetails, markRefundPaid, confirmRefund, disputeRefund };
