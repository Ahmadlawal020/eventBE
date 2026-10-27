const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const Refund = require("../../models/client/eventRefund.schema");
const { normalizeRefundBankDetails } = require("../../services/refundBankDetails.service");
const { queueNotices } = require("../../services/refundNotifications.service");
const fail = (message, statusCode = 409) => Object.assign(Error(message), { statusCode });
// A deliberate, version-checked write must succeed before an organiser sends money.
// It has no timed expiry: an uncertain external transfer must never unlock the account.
exports.prepare = async (req, res) => {
  try {
    const version = req.body?.bankDetailsVersion;
    if (!Number.isSafeInteger(version) || version < 0)
      throw fail("Refresh the refund account before preparing payment.", 400);
    const refund = await mongoose.connection.transaction(async session => {
      const record = await Refund.findOne({ _id: req.params.refundId, organiser: req.user.id,
        ticketId: { $type: "objectId" }, markedPaidAt: null, "supportRequest.status": { $ne: "OPEN" },
        status: { $in: ["DUE_FROM_ORGANISER", "OVERDUE"] },
      }).select("+bankDetails.accountNumber +bankDetails.bankCode").session(session);
      if (!record) throw fail("This refund is not available for settlement.");
      if ((record.bankDetailsVersion || 0) !== version)
        throw fail("The holder changed their account. Refresh and check the new details before paying.");
      if (record.settlement?.id) {
        // Serialize a retry with concurrent support recovery instead of returning a stale lock.
        record.markModified("settlement");
        await record.save({ session });
        return record;
      }
      if (record.receipt?.uploadedAt)
        throw fail("This refund has earlier payment proof. Ask support to review it before preparing another payment.");
      normalizeRefundBankDetails(record.bankDetails?.toObject?.() || record.bankDetails);
      record.bankDetailsVersion = version;
      record.settlement = { id: randomUUID(), bankDetailsVersion: version,
        preparedAt: new Date(), preparedBy: req.user.id };
      await record.save({ session });
      await queueNotices([{ key: "refund-settlement:" + record.settlement.id,
        recipient: record.buyer, sender: req.user.id, type: "SYSTEM",
        title: "Refund account locked for payment",
        message: "The organiser is preparing your refund. Your bank details are locked. Contact support if they need correcting.",
        data: { refundId: String(record._id), screen: "RefundDetails" },
      }], session);
      return record;
    });
    res.json({ success: true, data: refund });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false,
      message: error.statusCode ? error.message : "Could not prepare refund settlement. Refresh before sending money." });
  }
};
