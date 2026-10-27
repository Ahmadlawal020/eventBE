const { randomUUID } = require("crypto");
const Health = require("../models/client/refundWorkerHealth.schema");
const Booking = require("../models/client/eventBooking.schema");
const Media = require("../models/client/eventMedia.schema");
const Review = require("../models/client/ticketVoidReview.schema");
async function runWorker(name, action) {
  // Separate upsert from conditional claim; two processes may safely bootstrap together.
  try { await Health.updateOne({ name }, { $setOnInsert: { name, lockedUntil: new Date(0) } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  const token = randomUUID();
  const filter = { name, lockToken: token };
  const claim = await Health.findOneAndUpdate({ name, $or: [{ lockedUntil: { $lte: new Date() } }, { lockedUntil: null }] },
    { $set: { lockToken: token, lockedUntil: new Date(Date.now() + 15 * 60000), startedAt: new Date(), heartbeatAt: new Date() } }, { new: true });
  if (!claim) return { skipped: true };
  const timer = setInterval(() => {
    Health.updateOne(filter, { $set: { lockedUntil: new Date(Date.now() + 15 * 60000), heartbeatAt: new Date() } })
      .catch(error => console.error("[WORKER HEARTBEAT]", name, error.name));
  }, 30000);
  timer.unref();
  try {
    const result = await action();
    await Health.updateOne(filter, { $set: { completedAt: new Date(), heartbeatAt: new Date(), result, lastError: null } });
    return result;
  } catch (error) {
    await Health.updateOne(filter, { $set: { lastError: String(error.message).slice(0, 300) } });
    throw error;
  } finally {
    clearInterval(timer);
    await Health.updateOne(filter, { $set: { lockedUntil: new Date(0) } });
  }
}
async function getEventOperations() {
  const pendingFilter = { paymentStatus: "PENDING", status: "ACTIVE", reservationExpiresAt: { $lte: new Date() } };
  const [workers, paymentBacklog, oldest, paymentExceptions, mediaFailures, voidReviews] = await Promise.all([
    Health.find({ name: { $in: ["event-completion", "payment-reconciliation", "event-media-cleanup", "refund-operations", "event-alert-delivery"] } }).select("-lockToken").lean(),
    Booking.countDocuments(pendingFilter),
    Booking.findOne(pendingFilter).sort({ reservationExpiresAt: 1 }).select("reservationExpiresAt").lean(),
    Booking.countDocuments({ paymentResolutionRequired: true }),
    Media.countDocuments({ state: { $ne: "DELETED" }, lastError: { $ne: null } }),
    Review.countDocuments({ status: "PENDING" }),
  ]);
  const oldestPaymentSeconds = oldest ? Math.max(0, Math.floor((Date.now() - oldest.reservationExpiresAt.getTime()) / 1000)) : 0;
  const alerts = [];
  for (const [name, threshold] of [["event-completion", 35 * 60000], ["payment-reconciliation", 12 * 60000], ["event-media-cleanup", 25 * 60000], ["refund-operations", 5 * 60000]]) {
    const worker = workers.find(row => row.name === name);
    if (!worker?.heartbeatAt || Date.now() - new Date(worker.heartbeatAt).getTime() > threshold) alerts.push(name + " heartbeat is missing or stale");
    if (worker?.startedAt && new Date(worker.lockedUntil).getTime() > Date.now() &&
        Date.now() - new Date(worker.startedAt).getTime() > threshold)
      alerts.push(name + " exceeded its expected run duration");
    if (!worker?.completedAt || Date.now() - new Date(worker.completedAt).getTime() > threshold * 2)
      alerts.push(name + " has no recent successful completion");
    if (worker?.lastError || worker?.result?.failed || worker?.result?.deferred) alerts.push(name + " has unresolved errors");
  }
  const delivery = workers.find(row => row.name === "event-alert-delivery");
  if (process.env.EVENT_ALERT_WEBHOOK_URL && (delivery?.lastError || !delivery?.completedAt || Date.now() - new Date(delivery.completedAt).getTime() > 5 * 60000))
    alerts.push("External event alert delivery has no recent successful check");
  if (!process.env.EVENT_ALERT_WEBHOOK_URL) alerts.push("External event alert delivery is not configured");
  if (oldestPaymentSeconds > 3600) alerts.push("Payment reconciliation backlog exceeds one hour");
  if (paymentExceptions) alerts.push(paymentExceptions + " collected payments need finance review");
  if (mediaFailures) alerts.push(mediaFailures + " image cleanup failures need attention");
  if (voidReviews) alerts.push(voidReviews + " paid-ticket voids await refund review");
  return { workers, paymentBacklog, oldestPaymentSeconds, paymentExceptions, mediaFailures, voidReviews, alerts };
}
module.exports = { runWorker, getEventOperations };
