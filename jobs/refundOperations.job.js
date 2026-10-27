const { CronJob } = require("cron");
const { runRefundOperations } = require("../services/refundOperations.service");
let running = false;
async function run() {
  if (running) return;
  running = true;
  try {
    await require("../services/eventOperations.service").runWorker("refund-operations", runRefundOperations);
  } catch (error) {
    console.error("[REFUND OPERATIONS FAILED]", error.message);
  } finally {
    running = false;
  }
}
const isTest = process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT;
const job = new CronJob("* * * * *", run, null, !isTest, "UTC");
module.exports = { job, run };
