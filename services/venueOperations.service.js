const Health = require("../models/client/refundWorkerHealth.schema");
const Booking = require("../models/client/eventCenterBooking.schema");
const Payout = require("../models/client/venuePayout.schema");
const workerThresholds = { "venue-checkout": 5, "venue-payout": 5, "venue-refund": 5, "venue-review-expiry": 5, "venue-reminders": 15 };
async function getVenueOperations() {
  const now = new Date(), overdue = { paymentStatus: "PENDING", status: "ACTIVE", $or: [
    { reservationExpiresAt: { $lte: now } }, { reservationExpiresAt: null, createdAt: { $lte: new Date(+now - 30 * 60000) } } ] };
  const [workers, paymentBacklog, oldest, paymentExceptions, refundAttention, payoutAttention, stalledPayouts, refundOperations] = await Promise.all([
    Health.find({ name: { $in: Object.keys(workerThresholds) } }).select("-lockToken").lean(),
    Booking.countDocuments(overdue), Booking.findOne(overdue).sort({ createdAt: 1 }).select("createdAt reservationExpiresAt").lean(),
    Booking.countDocuments({ paymentResolutionRequired: true }), Booking.countDocuments({ "refund.state": "NEEDS_ATTENTION" }),
    Payout.countDocuments({ status: { $in: ["NEEDS_ATTENTION", "FAILED"] } }),
    Payout.countDocuments({ status: { $in: ["READY", "PREPARING", "SUBMITTING", "PENDING"] }, createdAt: { $lte: new Date(+now - 3600000) } }), require("./eventCenterRefundOperations.service").getRefundOperations(),
  ]);
  const alerts = refundOperations.alerts.map(message => "Venue refunds: " + message);
  for (const [name, minutes] of Object.entries(workerThresholds)) {
    const worker = workers.find(row => row.name === name), threshold = minutes * 60000;
    if (!worker?.heartbeatAt || +now - +new Date(worker.heartbeatAt) > threshold) alerts.push(name + " heartbeat is missing or stale");
    if (!worker?.completedAt || +now - +new Date(worker.completedAt) > threshold * 2) alerts.push(name + " has no recent successful completion");
    if (worker?.lastError || worker?.result?.failed || worker?.result?.deferred) alerts.push(name + " has unresolved errors");
    if (+new Date(worker?.lockedUntil) > +now && +now - +new Date(worker.startedAt) > threshold) alerts.push(name + " exceeded its expected run duration");
  }
  const oldestPaymentSeconds = oldest ? Math.max(0, Math.floor((+now - +(oldest.reservationExpiresAt || new Date(+oldest.createdAt + 30 * 60000))) / 1000)) : 0;
  if (oldestPaymentSeconds > 3600) alerts.push("Venue checkout reconciliation backlog exceeds one hour");
  if (paymentExceptions) alerts.push(paymentExceptions + " venue payments need finance review");
  if (refundAttention) alerts.push(refundAttention + " automatic venue reversals need attention");
  if (stalledPayouts) alerts.push(stalledPayouts + " venue payouts remain unresolved after one hour");
  if (payoutAttention) alerts.push(payoutAttention + " venue payouts need attention");
  return { workers, paymentBacklog, oldestPaymentSeconds, paymentExceptions, refundAttention, payoutAttention, stalledPayouts, refundOperations, alerts };
}
module.exports = { getVenueOperations, workerThresholds };
