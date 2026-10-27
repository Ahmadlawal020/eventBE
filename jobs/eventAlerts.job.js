const { CronJob } = require("cron");
const { deliverEventAlerts } = require("../services/eventAlertDelivery.service");
const isTest = process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT;
module.exports = new CronJob("* * * * *", () => deliverEventAlerts().catch(error =>
  console.error("[EVENT ALERT DELIVERY]", error.name)), null, !isTest, "UTC");
