const { CronJob } = require("cron");
const mongoose = require("mongoose");
const EventRefund = require("../models/client/eventRefund.schema");
const { queueNotices } = require("../services/refundNotifications.service");

async function markOverdueEventRefunds() {
  let modifiedCount = 0;
  const now = new Date();
  const due = { $or: [
    { status: { $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER"] }, dueAt: { $lt: now } },
    { status: "MARKED_PAID", confirmationDueAt: { $lt: now } },
  ] };
  const candidates = await EventRefund.find(due).select("_id").limit(100).lean();
  for (const candidate of candidates) {
    const changed = await mongoose.connection.transaction(async session => {
      const refund = await EventRefund.findOneAndUpdate({ _id: candidate._id, ...due },
        { $set: { status: "OVERDUE" } }, { new: true, session });
      if (!refund) return false;
      const stage = refund.markedPaidAt ? "confirmation" : "payment";
      await queueNotices([refund.buyer, refund.organiser].map(recipient => ({
        key: `refund-overdue:${refund._id}:${stage}:${recipient}`, recipient,
        type: "SYSTEM", title: refund.markedPaidAt ? "Refund confirmation overdue" : "Cancellation refund overdue",
        message: refund.markedPaidAt ? "The organiser marked this refund paid. The buyer should confirm receipt or report a missing payment." : "The refund deadline has passed. Review the bank details and payment status, and contact support if needed.",
        data: { refundId: String(refund._id), eventId: String(refund.eventId),
          screen: String(recipient) === String(refund.organiser) ? "OrganiserRefunds" : "RefundDetails" },
      })), session);
      return true;
    });
    if (changed) modifiedCount++;
  }
  return { modifiedCount };
}
const isTest = process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT;
const job = new CronJob("0 * * * *", () => markOverdueEventRefunds().catch(error => console.error("[EVENT REFUND OVERDUE]", error)), null, !isTest, "UTC");
job.markOverdueEventRefunds = markOverdueEventRefunds;
module.exports = job;
