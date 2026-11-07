const mongoose = require("mongoose");
const EventCenterRefund = require("../models/client/eventCenterRefund.schema");
const { queueNotices } = require("../services/eventCenterRefundNotifications.service");

async function markOverdueEventCenterRefunds({ limit = 500 } = {}) {
  let failedCount = 0;
  let modifiedCount = 0;
  const now = new Date();
  const due = { $or: [
    { status: { $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER"] }, dueAt: { $lt: now } },
    { status: "MARKED_PAID", confirmationDueAt: { $lt: now } },
  ] };
  const candidates = await EventCenterRefund.find(due).select("_id").sort({ dueAt: 1, _id: 1 }).limit(limit).lean();
  for (const candidate of candidates) {
    try {
    const changed = await mongoose.connection.transaction(async session => {
      const refund = await EventCenterRefund.findOneAndUpdate({ _id: candidate._id, ...due },
        { $set: { status: "OVERDUE" } }, { new: true, session });
      if (!refund) return false;
      const stage = refund.markedPaidAt ? "confirmation" : "payment";
      await queueNotices([refund.buyer, refund.organiser].map(recipient => ({
        key: `refund-overdue:${refund._id}:${stage}:${recipient}`, recipient,
        type: "SYSTEM", title: refund.markedPaidAt ? "Refund confirmation overdue" : "Cancellation refund overdue",
        message: refund.markedPaidAt ? "The organiser marked this refund paid. The buyer should confirm receipt or report a missing payment." : "The refund deadline has passed. Review the bank details and payment status, and contact support if needed.",
        data: { refundId: String(refund._id), bookingId: String(refund.bookingId),
          screen: String(recipient) === String(refund.organiser) ? "OrganiserVenueRefund" : "VenueRefundDetails" },
      })), session);
      return true;
    });
    if (changed) modifiedCount++;
    } catch (error) { failedCount++; console.error("[REFUND OVERDUE RECORD]", String(candidate._id), error.message); }
  }
  return { modifiedCount, failedCount };
}
// Scheduled and monitored by eventCenterRefundOperations.job; exported for isolated testing.
module.exports = { markOverdueEventCenterRefunds };
