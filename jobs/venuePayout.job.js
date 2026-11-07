const Payout = require("../models/client/venuePayout.schema");
const { processVenuePayout } = require("../services/venuePayout.service");
async function settleVenuePayouts() {
  return require("../services/eventOperations.service").runWorker("venue-payout", async () => {
    const jobs = await Payout.find({ status: { $in: ["READY", "PREPARING", "SUBMITTING", "PENDING"] }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }] }).sort({ updatedAt: 1 }).limit(100);
    let failed = 0;
    for (const payout of jobs) {
      try { await processVenuePayout(payout._id); } catch (error) { failed++; console.error("[VENUE PAYOUT]", String(payout._id), error.message); }
    }
    return { processed: jobs.length, failed };
  });
}
module.exports = { settleVenuePayouts };
