const User = require("../models/client/user.schema");
const EventBooking = require("../models/client/eventBooking.schema");
const EventCenterBooking = require("../models/client/eventCenterBooking.schema");
const { ensureUserReferralCode, processReferralCommission } = require("./referral.service");

// Bounded round-robin scans recover missed commissions, reflect refunds and backfill old users.
// Checkpoints only optimize scans; restarting or running multiple workers is safe.
const checkpoints = {};
const reconcileReferrals = async (limit = 100) => {
  const users = await User.find({ $or: [{ referralCode: { $exists: false } }, { referralCode: null }, { referralCode: "" }] })
    .select("_id").limit(limit).lean();
  for (const user of users) await ensureUserReferralCode(user._id);
  for (const [sourceType, Model] of [["EVENT_TICKET", EventBooking], ["EVENT_CENTER_BOOKING", EventCenterBooking]]) {
    const query = checkpoints[sourceType] ? { _id: { $gt: checkpoints[sourceType] } } : {};
    const bookings = await Model.find(query).select("_id").sort({ _id: 1 }).limit(limit).lean();
    for (const booking of bookings) {
      try {
        await processReferralCommission({ sourceType, bookingId: booking._id, notify: false });
      } catch (error) {
        // Failed bookings are retried on the next full scan without blocking other bookings.
        console.error("[REFERRAL RECONCILIATION]", sourceType, String(booking._id), error.message);
      }
      checkpoints[sourceType] = booking._id;
    }
    if (bookings.length < limit) checkpoints[sourceType] = null;
  }
};
module.exports = { reconcileReferrals };
