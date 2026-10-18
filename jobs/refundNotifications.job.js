const { CronJob } = require("cron");
const { processRefundNotices } = require("../services/refundNotifications.service");
let running = false;
async function run() {
  if (running) return;
  running = true;
  try { await processRefundNotices(); }
  catch (error) { console.error("[REFUND NOTIFICATIONS]", error.message); }
  finally { running = false; }
}
const isTest = process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT;
const job = new CronJob("* * * * *", run, null, !isTest, "UTC");
module.exports = { job, run };
