const Health = require("../models/client/refundWorkerHealth.schema");
const { getEventOperations, runWorker } = require("./eventOperations.service");
async function deliverEventAlerts() {
  if (!process.env.EVENT_ALERT_WEBHOOK_URL) return { configured: false };
  const destination = new URL(process.env.EVENT_ALERT_WEBHOOK_URL);
  if (destination.protocol !== "https:" || destination.username || destination.password) throw Error("Event alert destination must use HTTPS without credentials in its URL");
  return runWorker("event-alert-delivery", async () => {
    const health = await getEventOperations();
    const previous = await Health.findOne({ name: "event-alert-delivery" }).lean();
    // Delivery health is shown in admin; excluding it here prevents self-generated alert changes.
    const alerts = health.alerts.filter(message => !message.startsWith("External event alert delivery"));
    const signature = JSON.stringify(alerts);
    const last = previous?.result;
    if (last?.signature === signature && Date.now() - new Date(last.sentAt).getTime() < 15 * 60000) return last;
    await require("axios").post(destination.href, { service: "event-operations", alerts, at: new Date().toISOString() },
      { timeout: 10000, maxRedirects: 0, headers: process.env.EVENT_ALERT_WEBHOOK_TOKEN ? { Authorization: "Bearer " + process.env.EVENT_ALERT_WEBHOOK_TOKEN } : {} });
    return { signature, sentAt: new Date() };
  });
}
module.exports = { deliverEventAlerts };
