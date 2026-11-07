const mongoose = require("mongoose");
const Booking = require("../models/client/eventCenterBooking.schema");
const Venue = require("../models/client/eventCenter.schema");
const { bookingSessions } = require("./bookingAttendance.service");
const { fail } = require("./venueAccess.service");
async function reserveVenueCheckout(venueId, expectedUpdatedAt, data) {
  return mongoose.connection.transaction(async session => {
    const venue = await Venue.findOneAndUpdate({ _id: venueId, status: "LISTED", archivedAt: null, updatedAt: expectedUpdatedAt },
      { $inc: { bookingVersion: 1 } }, { new: true, session });
    if (!venue) throw fail(409, "The venue changed. Refresh and retry checkout.");
    require("./checkoutSafety.service").venueQuote(venue, data);
    const first = bookingSessions(data)[0];
    const boundary = new Date(data.bookingUnit === "hour" || data.bookingMode === "REVIEW" ? first.startsAt : first.endsAt);
    const expiresAt = new Date(Math.min(Date.now() + 30 * 60000, +boundary));
    if (expiresAt <= new Date()) throw fail(409, "This booking can no longer be paid for.");
    const [booking] = await Booking.create([{ ...data, eventCenter: venueId, cancellationPolicy: { maxReschedules: 1, ...venue.cancellationPolicy?.toObject() }, rescheduleCount: 0,
      reservationExpiresAt: expiresAt, inventoryReserved: true }], { session });
    const field = data.bookingUnit === "hour" ? "unavailableSlots" : "unavailableDates";
    await Venue.updateOne({ _id: venueId }, { $push: { [`availability.${field}`]: { $each: data.selectedDates.map(d => ({ ...d, type: "BOOKED", bookingId: String(booking._id), pendingCheckout: true })) } } }, { session });
    return booking;
  });
}
async function expireVenueCheckout(id) {
  return mongoose.connection.transaction(async session => {
    const booking = await Booking.findOne({ _id: id, status: "ACTIVE", paymentStatus: "PENDING" }).session(session);
    if (!booking || new Date(booking.reservationExpiresAt || (+booking.createdAt + 30 * 60000)) > new Date()) return false;
    await Venue.updateOne({ _id: booking.eventCenter }, { $pull: { "availability.unavailableDates": { bookingId: String(id) }, "availability.unavailableSlots": { bookingId: String(id) } } }, { session });
    booking.status = "CANCELLED"; booking.paymentStatus = "FAILED"; booking.inventoryReserved = false;
    await booking.save({ session });
    await require("./venueBookingEvents.service").recordVenueEvent(booking, "CANCELLED", null, session, { reason: "Checkout expired without a completed payment. No booking was confirmed." });
    return true;
  });
}
async function reconcileVenueCheckouts({ limit = 100 } = {}) {
  const now = new Date();
  const due = await Booking.find({ status: "ACTIVE", paymentStatus: "PENDING", $and: [
    { $or: [{ reservationExpiresAt: { $lte: now } }, { reservationExpiresAt: null, createdAt: { $lte: new Date(+now - 30 * 60000) } }] },
    { $or: [{ "reconciliation.nextAttemptAt": null }, { "reconciliation.nextAttemptAt": { $lte: now } }] },
  ] }).sort({ "reconciliation.nextAttemptAt": 1, createdAt: 1 }).limit(limit).lean();
  let deferred = 0;
  for (const booking of due) {
    try {
      const transaction = await require("./payment").getPaymentGateway().verifyPayment(booking.paymentReference);
      if (transaction.status === "success") {
        await require("./checkoutSafety.service").completePayment(booking.paymentReference, transaction, { kind: "EVENT_CENTER" });
      } else if (["failed", "abandoned", "pending", "ongoing"].includes(transaction.status)) await expireVenueCheckout(booking._id);
      else throw Error("Payment remains unresolved.");
    } catch (error) {
      const missing = [400, 404].includes(error.response?.status) && /^transaction (?:not found|reference not found)[.!]?$/i.test(error.response?.data?.message || "");
      if (missing) await expireVenueCheckout(booking._id);
      else { deferred++; await Booking.updateOne({ _id: booking._id, paymentStatus: "PENDING" }, { $inc: { "reconciliation.attempts": 1 }, $set: {
        "reconciliation.nextAttemptAt": new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(booking.reconciliation?.attempts || 0, 6))),
        "reconciliation.lastError": "Payment verification unavailable; reservation retained.",
      } }); }
    }
  }
  return { processed: due.length, deferred };
}
async function completePastVenueBookings() {
  const checkpoints = mongoose.connection.collection("worker_scan_checkpoints");
  const completionCursor = (await checkpoints.findOne({ _id: "venue-completion" }))?.cursor;
  const candidates = await Booking.find({ ...(completionCursor ? { _id: { $gt: completionCursor } } : {}), paymentStatus: "COMPLETED", status: { $in: ["ACTIVE", "CONFIRMED"] }, paymentResolutionRequired: { $ne: true },
    "selectedDates.date": { $lte: new Date() } }).sort({ _id: 1 }).limit(100).select("_id selectedDates bookingUnit").lean();
  let completed = 0;
  for (const candidate of candidates) {
    const sessions = bookingSessions(candidate);
    if (!sessions.length || sessions.some(s => new Date(s.endsAt) > new Date())) continue;
    await mongoose.connection.transaction(async session => {
      const booking = await Booking.findOne({ _id: candidate._id, status: { $in: ["ACTIVE", "CONFIRMED"] }, paymentStatus: "COMPLETED", paymentResolutionRequired: { $ne: true } }).session(session);
      if (!booking || bookingSessions(booking).some(s => new Date(s.endsAt) > new Date())) return;
      booking.status = "COMPLETED"; await booking.save({ session });
      await require("./venueBookingEvents.service").recordVenueEvent(booking, "COMPLETED", null, session);
      completed++;
    });
  }
  await checkpoints.updateOne({ _id: "venue-completion" }, { $set: { cursor: candidates.length === 100 ? candidates[candidates.length - 1]._id : null } }, { upsert: true });
  return { completed };
}
module.exports = { reserveVenueCheckout, expireVenueCheckout, reconcileVenueCheckouts, completePastVenueBookings };
