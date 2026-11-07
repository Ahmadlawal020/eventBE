const { createHash, randomUUID } = require("crypto");
const Alert = require("../models/client/operationalAlert.schema");
function destination() {
  if (!process.env.EVENT_ALERT_WEBHOOK_URL) throw Error("EVENT_ALERT_WEBHOOK_URL is not configured");
  const url = new URL(process.env.EVENT_ALERT_WEBHOOK_URL);
  if (url.protocol !== "https:" || url.username || url.password) throw Error("Alert destination must use HTTPS without URL credentials");
  return url;
}
async function deliverEventAlerts({ canary = false, force = false } = {}) {
  if (!process.env.EVENT_ALERT_WEBHOOK_URL && !canary) return { configured: false };
  const url = destination(), hash = createHash("sha256").update(url.href).digest("hex");
  return require("./eventOperations.service").runWorker("event-alert-delivery", async () => {
    const health = canary ? { alerts: ["Munasaba operational alert delivery test"] } : await require("./eventOperations.service").getEventOperations();
    const alerts = health.alerts.filter(message => !message.startsWith("External event alert delivery")).sort();
    const signature = JSON.stringify(alerts);
    const previous = await Alert.findOne({ destinationHash: hash }).sort({ createdAt: -1, _id: -1 }).lean();
    if (canary || !previous || previous.signature !== signature || previous.deliveredAt && Date.now() - +new Date(previous.createdAt) >= 15 * 60000)
      await Alert.create({ destinationHash: hash, signature, alerts, canary });
    let delivered = 0, deferred = 0;
    for (let i = 0; i < 10; i++) {
      const token = randomUUID();
      const row = await Alert.findOneAndUpdate({ destinationHash: hash, deliveredAt: null, nextAttemptAt: { $lte: new Date() }, lockedUntil: { $lte: new Date() } },
        { $set: { lockToken: token, lockedUntil: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
      if (!row) break;
      const filter = { _id: row._id, lockToken: token };
      try {
        await require("axios").post(url.href, { service: "event-operations", deliveryId: String(row._id), alerts: row.alerts, canary: Boolean(row.canary), at: row.createdAt.toISOString() },
          { timeout: 10000, maxRedirects: 0, headers: { "Idempotency-Key": String(row._id), ...(process.env.EVENT_ALERT_WEBHOOK_TOKEN ? { Authorization: "Bearer " + process.env.EVENT_ALERT_WEBHOOK_TOKEN } : {}) } });
        await Alert.updateOne(filter, { $set: { deliveredAt: new Date(), lockedUntil: new Date(0), lastError: null } }); delivered++;
      } catch (error) {
        await Alert.updateOne(filter, { $set: { lockedUntil: new Date(0), lastError: "Alert endpoint did not acknowledge delivery", nextAttemptAt: new Date(Date.now() + Math.min(300000, 30000 * 2 ** Math.min(row.attempts, 4))) } });
        deferred++;
      }
    }
    const pending = await Alert.countDocuments({ destinationHash: hash, deliveredAt: null });
    return { configured: true, delivered, deferred, pending };
  }, { force });
}
module.exports = { deliverEventAlerts };
