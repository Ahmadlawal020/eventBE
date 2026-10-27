const Outbox = require("../models/client/notificationOutbox.schema");
const Refund = require("../models/client/eventRefund.schema");
const Attempts = require("../models/client/refundUploadAttempt.schema");
const Health = require("../models/client/refundWorkerHealth.schema");
const { processRefundNotices } = require("./refundNotifications.service");
const { cleanupRefundUploads } = require("./refundUploadCleanup.service");
const { markOverdueEventRefunds } = require("../jobs/eventRefundOverdue.job");
const bounded = (value, fallback, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};
async function measured(name, action) {
  await Health.updateOne(
    { name },
    { $set: { startedAt: new Date() } },
    { upsert: true },
  );
  try {
    const result = await action();
    await Health.updateOne(
      { name },
      { $set: { completedAt: new Date(), result, lastError: null } },
    );
    return result;
  } catch (error) {
    await Health.updateOne(
      { name },
      { $set: { lastError: String(error.message).slice(0, 500) } },
    );
    console.error("[REFUND WORKER FAILED]", name, error.message);
  }
}
async function runRefundOperations() {
  await Promise.all([
    measured("notifications", () =>
      processRefundNotices({
        limit: bounded(process.env.REFUND_NOTICE_BATCH, 50, 500),
        delayMs: bounded(process.env.REFUND_NOTICE_DELAY_MS, 600, 10000),
      }),
    ),
    measured("overdue", () =>
      markOverdueEventRefunds({
        limit: bounded(process.env.REFUND_OVERDUE_BATCH, 500, 5000),
      }),
    ),
    measured("upload-cleanup", () =>
      cleanupRefundUploads({
        limit: bounded(process.env.REFUND_CLEANUP_BATCH, 100, 1000),
      }),
    ),
  ]);
  const health = await getRefundOperations();
  if (health.alerts.length)
    console.error("[REFUND OPERATIONS ALERT]", JSON.stringify(health.alerts));
}
async function getRefundOperations() {
  const now = new Date();
  const due = {
    $or: [
      {
        status: { $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER"] },
        dueAt: { $lt: now },
      },
      { status: "MARKED_PAID", confirmationDueAt: { $lt: now } },
    ],
  };
  const [pending, failed, oldest, overdue, uploads, support, workers, legacyRefunds] =
    await Promise.all([
      Outbox.countDocuments({ completedAt: null, failedAt: null }),
      Outbox.countDocuments({ failedAt: { $ne: null } }),
      Outbox.findOne({ completedAt: null, failedAt: null })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
      Refund.countDocuments(due),
      Attempts.countDocuments({
        state: { $ne: "DELETED" },
        cleanupAfter: { $lte: now },
      }),
      Refund.countDocuments({ "supportRequest.status": "OPEN" }),
      Health.find().select("-lockToken").lean(),
      Refund.countDocuments({ ticketId: null }),
    ]);
  const oldestPendingSeconds = oldest
    ? Math.max(0, Math.floor((now - oldest.createdAt) / 1000))
    : 0;
  const alerts = [];
  if (legacyRefunds) alerts.push(legacyRefunds + " legacy refund records need reconciliation before ticket-level settlement");
  if (failed)
    alerts.push(
      `${failed} notices require manual retry or recipient correction`,
    );
  if (oldestPendingSeconds > 900)
    alerts.push("Oldest pending notice exceeds 15 minutes");
  if (overdue > 500) alerts.push("Overdue processing backlog exceeds 500");
  for (const name of ["notifications", "overdue", "upload-cleanup"]) {
    const worker = workers.find((item) => item.name === name);
    if (!worker?.completedAt || now - worker.completedAt > 300000)
      alerts.push(`${name} worker heartbeat is missing or stale`);
    if (
      worker?.lastError ||
      worker?.result?.failed ||
      worker?.result?.failedCount
    )
      alerts.push(`${name} worker has failures`);
  }
  return {
    pending,
    failed,
    oldestPendingSeconds,
    overdue,
    uploads,
    support,
    legacyRefunds,
    workers,
    alerts,
  };
}
module.exports = { runRefundOperations, getRefundOperations };
