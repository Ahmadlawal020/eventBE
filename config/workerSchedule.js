// UTC timers only wake durable, idempotent database tasks. API processes never schedule these.
module.exports = [
  { name: "event-completion", cron: "*/15 * * * *", intervalMs: 900000, run: () => require("../services/eventOperations.service").runWorker("event-completion", require("../jobs/eventCompletion.job").markCompletedEvents) },
  { name: "payment-reconciliation", cron: "*/5 * * * *", intervalMs: 300000, run: () => require("../services/eventOperations.service").runWorker("payment-reconciliation", require("../jobs/paymentReservationExpiry.job").expireReservations) },
  ...[
    ["event-media-cleanup", "*/10 * * * *", 600000, "eventMediaCleanup", "run"],
    ["refund-operations", "* * * * *", 60000, "refundOperations", "run"],
    ["venue-refund-operations", "* * * * *", 60000, "eventCenterRefundOperations", "run"],
    ["notification-triggers", "*/2 * * * *", 120000, "notificationTrigger", "run"],
    ["referral-reconciliation", "* * * * *", 60000, "referralReconciliation", "run"],
    ["venue-checkout", "* * * * *", 60000, "venueCheckout", "run"],
    ["venue-payout", "* * * * *", 60000, "venuePayout", "settleVenuePayouts"],
    ["venue-refund", "* * * * *", 60000, "venueRefund", "processVenueRefunds"],
    ["venue-review-expiry", "* * * * *", 60000, "reviewBookingExpiry", "expirePendingBookings"],
    ["venue-reminders", "*/5 * * * *", 300000, "venueReminder", "run"],
    ["event-alert-delivery", "* * * * *", 60000, "eventAlerts", "run"],
  ].map(([name, cron, intervalMs, file, method]) => ({ name, cron, intervalMs, run: () => require("../jobs/" + file + ".job")[method]() })),
];
