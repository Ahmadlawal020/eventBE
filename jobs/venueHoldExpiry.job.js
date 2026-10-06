const { CronJob } = require("cron");
const Hold = require("../models/client/venueHold.schema");
const { resolveHold } = require("../services/venueHold.service");
let running = false;
async function expireHolds() {
  if (running) return; running = true;
  try {
    const holds = await Hold.find({ status: "ACTIVE", expiresAt: { $lte: new Date() } }).limit(200).lean();
    for (const hold of holds) try { await resolveHold(hold.eventCenter, hold._id, "EXPIRE", null); } catch (error) { if (error.status !== 409) console.error("[EXPIRE HOLD]", error.message); }
  } finally { running = false; }
}
module.exports = new CronJob("* * * * *", () => expireHolds().catch(error => console.error("[HOLD EXPIRY]", error.message)), null, true, "UTC");
