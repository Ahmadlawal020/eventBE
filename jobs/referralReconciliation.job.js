const { CronJob } = require("cron");
const User = require("../models/client/user.schema");
const ReferralEarning = require("../models/client/referralEarning.schema");
const { reconcileReferrals } = require("../services/referralReconciliation.service");
let running = false;
const run = async () => {
  if (running) return;
  running = true;
  try {
    await Promise.all([User.init(), ReferralEarning.init()]);
    await reconcileReferrals();
  } catch (error) {
    console.error("[REFERRAL RECONCILIATION]", error.message);
  } finally {
    running = false;
  }
};
new CronJob("0 * * * * *", run, null, true);
void run();
