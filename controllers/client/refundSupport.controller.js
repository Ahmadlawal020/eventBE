const mongoose = require("mongoose");
const Refund = require("../../models/client/eventRefund.schema");
const Audit = require("../../models/management/adminAuditLog.schema");
const { queueNotices } = require("../../services/refundNotifications.service");
const fail = (message, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
async function requestSupport(req, res) {
  const reason = req.body?.reason;
  if (typeof reason !== "string" || !reason.trim() || reason.length > 1000)
    return res
      .status(400)
      .json({ message: "Describe the issue in 1 to 1000 characters." });
  const refund = await mongoose.connection.transaction(async (session) => {
    const record = await Refund.findOneAndUpdate(
      {
        _id: req.params.refundId,
        ticketId: { $type: "objectId" },
        buyer: req.user.id,
        status: { $ne: "CONFIRMED_BY_BUYER" },
        "supportRequest.status": { $ne: "OPEN" },
      },
      {
        $set: {
          supportRequest: {
            reason: reason.trim(),
            requestedAt: new Date(),
            status: "OPEN",
          },
          "managementCase.status": "OPEN",
        },
        $unset: {
          "managementCase.resolution": 1,
          "managementCase.resolvedAt": 1,
          "managementCase.resolvedBy": 1,
        },
      },
      { new: true, session },
    );
    if (record)
      await queueNotices(
        [
          {
            key: `refund-support:${record._id}:${record.updatedAt.getTime()}`,
            recipient: record.organiser,
            sender: req.user.id,
            type: "SYSTEM",
            title: "Refund support requested",
            message:
              "A ticket holder requested help with their refund. The request is available to support staff.",
            data: {
              eventId: String(record.eventId),
              refundId: String(record._id),
              screen: "OrganiserRefunds",
            },
          },
        ],
        session,
      );
    return record;
  });
  if (!refund)
    return res
      .status(409)
      .json({
        message:
          "A support request is already open, or this refund is unavailable.",
      });
  return res.json({ success: true, data: refund.supportRequest });
}
async function recoverUnpaidRefund(req, res) {
  try {
    const { reason, confirmNoPayment } = req.body || {};
    if (
      !mongoose.isValidObjectId(req.params.id) ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 1000 ||
      confirmNoPayment !== true
    )
      throw fail(
        "Provide a reason and confirm with the organiser that no transfer has occurred.",
        400,
      );
    await mongoose.connection.transaction(async (session) => {
      const refund = await Refund.findOne({
        _id: req.params.id,
        ticketId: { $type: "objectId" },
        markedPaidAt: null,
        status: {
          $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER", "OVERDUE"],
        },
        "supportRequest.status": "OPEN",
      })
        .select(
          "+bankDetails.accountNumber +bankDetails.bankCode +receipt.publicId +recoveryHistory +managementCase",
        )
        .session(session);
      if (!refund)
        throw fail(
          "Only unpaid refunds with an open holder support request can be reopened. Paid records remain locked.",
        );
      const actor = req.managementStaff?._id || req.user.id;
      refund.recoveryHistory = refund.recoveryHistory || [];
      refund.recoveryHistory.push({
        actor,
        reason: reason.trim(),
        recoveredAt: new Date(),
        bankDetails: refund.bankDetails?.toObject?.() || refund.bankDetails,
        receipt: refund.receipt?.toObject?.() || refund.receipt,
        settlement: refund.settlement?.toObject?.() || refund.settlement,
      });
      refund.settlement = undefined;
      refund.bankDetailsVersion = (refund.bankDetailsVersion || 0) + 1;
      refund.bankDetails = undefined;
      refund.receipt = undefined;
      refund.pendingReceiptPublicId = undefined;
      refund.bankDetailsSubmittedAt = undefined;
      refund.status =
        refund.dueAt < new Date() ? "OVERDUE" : "AWAITING_BUYER_DETAILS";
      refund.supportRequest.status = "RESOLVED";
      refund.managementCase.status = "IN_REVIEW";
      refund.managementCase.notes.push({
        author: actor,
        body: `Unpaid refund reopened after confirming no transfer: ${reason.trim()}`,
      });
      await refund.save({ session });
      await Audit.create(
        [
          {
            admin: actor,
            action: "REOPEN_UNPAID_EVENT_REFUND",
            targetType: "EventRefund",
            targetId: refund._id,
            metadata: {
              reason: reason.trim(),
              confirmedNoPayment: true,
              evidencePreserved: true,
            },
            ipAddress: req.ip,
          },
        ],
        { session },
      );
      await queueNotices(
        [refund.buyer, refund.organiser].map((recipient) => ({
          key: `refund-reopened:${refund._id}:${refund.recoveryHistory.length}:${recipient}`,
          recipient,
          type: "SYSTEM",
          title: "Refund account reopened",
          message:
            "Support reopened the unpaid refund. The holder must submit corrected bank details before payment.",
          data: {
            eventId: String(refund.eventId),
            refundId: String(refund._id),
            screen:
              String(recipient) === String(refund.organiser)
                ? "OrganiserRefunds"
                : "RefundDetails",
          },
        })),
        session,
      );
    });
    return res.json({ success: true });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({
        message: error.statusCode
          ? error.message
          : "Could not reopen refund. No changes were committed.",
      });
  }
}
module.exports = { requestSupport, recoverUnpaidRefund };
