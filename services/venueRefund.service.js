const { randomUUID } = require("crypto");
const mongoose = require("mongoose");
const Booking = require("../models/client/eventCenterBooking.schema");
const { getPaymentGateway } = require("./payment");
function refundOutcome(refund, booking) {
  if (!refund || Number(refund.amount) !== booking.refund.amountMinor || refund.currency !== booking.totalPrice.currency)
    return "NEEDS_ATTENTION";
  if (refund.status === "processed") return "PROCESSED";
  if (["pending", "processing"].includes(refund.status)) return "PENDING";
  return "NEEDS_ATTENTION";
}
async function processVenueRefund(id) {
  const token = randomUUID();
  const booking = await Booking.findOneAndUpdate({ _id: id, status: "CANCELLED",
    "refund.state": { $in: ["QUEUED", "SUBMITTING", "PENDING", "NEEDS_ATTENTION"] },
    $or: [{ "refund.leaseUntil": { $exists: false } }, { "refund.leaseUntil": { $lte: new Date() } }],
  }, { $set: { "refund.leaseUntil": new Date(Date.now() + 120000), "refund.leaseToken": token } }, { new: true });
  if (!booking) return;
  const filter = { _id: id, "refund.leaseToken": token };
  const gateway = getPaymentGateway();
  let state = booking.refund.state, providerId = booking.refund.providerId, lastError;
  try {
    let response;
    if (state === "QUEUED") {
      // Persist intent before the provider call. A crash must never trigger another blind POST.
      const claimed = await Booking.updateOne({ ...filter, "refund.state": "QUEUED", "refund.leaseUntil": { $gt: new Date() } },
        { $set: { "refund.state": "SUBMITTING" }, $inc: { "refund.attempts": 1 } });
      if (!claimed.modifiedCount) return;
      state = "SUBMITTING";
      response = await gateway.refundPayment(booking.paymentReference);
    } else if (providerId) response = await gateway.verifyRefund(providerId);
    else {
      const transaction = await gateway.verifyPayment(booking.paymentReference);
      const refunds = await gateway.listRefunds(transaction.id);
      // Multiple/partial refunds require an operator to reconcile, never another automatic POST.
      if (refunds.length === 1) response = refunds[0];
    }
    if (response?.id) providerId = String(response.id);
    state = refundOutcome(response, booking);
    if (state === "NEEDS_ATTENTION") lastError = "Refund outcome needs provider reconciliation. No additional refund was submitted.";
  } catch (error) {
    lastError = "Provider reconciliation unavailable: " + (error.response?.status || error.code || "network error");
    state = state === "QUEUED" ? "QUEUED" : "NEEDS_ATTENTION";
  }
  await mongoose.connection.transaction(async session => {
    const result = await Booking.updateOne(filter, { $set: {
      "refund.state": state, "refund.providerId": providerId, "refund.lastError": lastError || "",
      "refund.leaseUntil": new Date(Date.now() + (state === "NEEDS_ATTENTION" ? 15 : 1) * 60000),
      paymentStatus: state === "PROCESSED" ? "REFUNDED" : state === "NEEDS_ATTENTION" ? "FAILED_REFUND" : "COMPLETED",
      paymentResolutionRequired: state !== "PROCESSED",
    } }, { session });
    if (result.modifiedCount && state === "PROCESSED") await require("./eventCenterRefundNotifications.service").queueNotices([{
      key: "venue-refunded:" + id, recipient: booking.buyer, type: "SYSTEM", title: "Refund completed",
      message: "The payment provider confirmed your venue booking refund.", data: { screen: "BookingDetails", ticketId: String(id) },
    }], session);
  });
}
async function processVenueRefunds() {
  const due = await Booking.find({ "refund.state": { $in: ["QUEUED", "SUBMITTING", "PENDING", "NEEDS_ATTENTION"] },
    $or: [{ "refund.leaseUntil": { $exists: false } }, { "refund.leaseUntil": { $lte: new Date() } }],
  }).select("_id").limit(100).lean();
  let failed = 0;
  for (const booking of due) {
    try { await processVenueRefund(booking._id); }
    catch (error) { failed++; console.error("[VENUE REFUND]", String(booking._id), error.message); }
  }
  return { processed: due.length, failed };
}
module.exports = { processVenueRefund, processVenueRefunds, refundOutcome };
