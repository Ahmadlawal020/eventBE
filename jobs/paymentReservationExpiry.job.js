const { CronJob } = require("cron");
const Booking = require("../models/client/eventBooking.schema");
const { getPaymentGateway } = require("../services/payment");
const {
  expireEventReservation,
  completePayment,
} = require("../services/checkoutSafety.service");
const {
  notifyPaymentCompletion,
} = require("../services/paymentCompletionNotifications.service");
const { recordBookingReferral } = require("../services/referral.service");
let running = false;

async function deferReconciliation(booking, message, now) {
  const attempts = (booking.reservationReconciliation?.attempts || 0) + 1;
  const delay = Math.min(3600000, 300000 * 2 ** Math.min(attempts - 1, 4));
  await Booking.updateOne(
    { _id: booking._id, paymentStatus: "PENDING", status: "ACTIVE" },
    {
      $inc: { "reservationReconciliation.attempts": 1 },
      $set: {
        "reservationReconciliation.lastCheckedAt": now,
        "reservationReconciliation.nextAttemptAt": new Date(
          now.getTime() + delay,
        ),
        "reservationReconciliation.lastError": message.slice(0, 500),
      },
    },
  );
}

async function expireReservations() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    let processed = 0, deferred = 0;
    const bookings = await Booking.find({
      paymentStatus: "PENDING",
      status: "ACTIVE",
      reservationExpiresAt: { $lte: now },
      $or: [
        { "reservationReconciliation.nextAttemptAt": { $exists: false } },
        { "reservationReconciliation.nextAttemptAt": null },
        { "reservationReconciliation.nextAttemptAt": { $lte: now } },
      ],
    })
      .sort({
        "reservationReconciliation.lastCheckedAt": 1,
        reservationExpiresAt: 1,
      })
      .limit(100);
    for (const booking of bookings) {
      processed++;
      try {
        const payment = await getPaymentGateway().verifyPayment(
          booking.paymentReference,
        );
        if (payment.status === "success") {
          const result = await completePayment(
            booking.paymentReference,
            payment,
            { kind: "EVENT_TICKET" },
          );
          if (!result.conflict)
            await recordBookingReferral(result.booking._id, "EVENT_TICKET");
          await notifyPaymentCompletion(result);
        } else if (
          ["abandoned", "failed", "pending", "ongoing"].includes(payment.status)
        ) {
          await expireEventReservation(booking._id);
        } else {
          deferred++;
          await deferReconciliation(
            booking,
            "Payment provider returned an unresolved status.",
            now,
          );
        }
      } catch (error) {
        // Only an explicit missing transaction is safe to expire. HTTP status alone
        // can also mean invalid credentials, configuration or a provider outage.
        const missing =
          [400, 404].includes(error.response?.status) &&
          /^transaction (?:not found|reference not found)[.!]?$/i.test(
            error.response?.data?.message || "",
          );
        if (missing) await expireEventReservation(booking._id);
        else {
          const message = error.response?.status
            ? `Provider HTTP ${error.response.status}`
            : "Payment verification unavailable";
          deferred++;
          await deferReconciliation(booking, message, now);
          console.error(
            "[PAYMENT RESERVATION]",
            booking._id.toString(),
            message,
          );
        }
      }
    }
    return { processed, deferred };
  } catch (error) {
    console.error("[PAYMENT RESERVATION WORKER]", error.message);
    throw error;
  } finally {
    running = false;
  }
}
if (process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT) {
  new CronJob("*/5 * * * *", () => require("../services/eventOperations.service").runWorker("payment-reconciliation", expireReservations).catch(error => console.error("[PAYMENT WORKER]", error.message)), null, true);
}
module.exports = { expireReservations };
