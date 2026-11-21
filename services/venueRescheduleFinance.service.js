const { createHash } = require("crypto");
const { bookingSessions } = require("./bookingAttendance.service");
const { fail } = require("./checkoutSafety.service");
const Operations = require("../models/client/bookingOperations.schema");
const minor = value => Math.round(Number(value || 0) * 100);
function duration(dates, unit) {
  return bookingSessions({ selectedDates: dates, bookingUnit: unit }).reduce((sum, s) => sum + (unit === "hour" ? (+new Date(s.endsAt) - +new Date(s.startsAt)) / 3600000 : 1), 0);
}
function review(booking, venue, quote, record = {}, warnings = []) {
  const manual = booking.bookingType === "MANUAL";
  if (!Number.isFinite(booking.totalPrice?.amount) || (!manual && (!Number.isFinite(booking.subtotalPrice?.amount) || booking.subtotalPrice.amount > booking.totalPrice.amount))) throw fail("This booking needs a price review before rescheduling.", 409);
  const originalTotal = minor(booking.totalPrice.amount);
  // Preserve the original platform fee; only the venue price changes.
  const fee = manual ? 0 : originalTotal - minor(booking.subtotalPrice.amount) + (record.rescheduleBuyerFeesMinor || 0);
  const oldTotal = minor(record.agreedPrice?.amount ?? booking.rescheduledPrice?.amount ?? booking.totalPrice.amount);
  const total = minor(quote.subtotalAmount) + fee;
  const originalSessions = bookingSessions({ selectedDates: booking.selectedDates || booking.dates, bookingUnit: booking.bookingUnit }).map(s => s.sessionId);
  const newSessions = bookingSessions({ selectedDates: quote.selectedDates, bookingUnit: booking.bookingUnit }).map(s => s.sessionId);
  if (JSON.stringify(originalSessions) === JSON.stringify(newSessions)) throw fail("Choose different dates or times before rescheduling.", 409);
  if (![total, oldTotal, fee].every(Number.isSafeInteger) || total <= 0 || fee < 0) throw fail("Invalid reschedule price.", 409);
  const summary = require("./bookingOperations.service").paymentSummary(booking, record);
  const data = { warnings, bookingId: String(booking._id), previousDates: booking.selectedDates || booking.dates, dates: quote.selectedDates,
    duration: quote.duration, bookingUnit: booking.bookingUnit, currency: quote.currency,
    previousPriceMinor: oldTotal, newPriceMinor: total, priceDifferenceMinor: total - oldTotal,
    paidMinor: summary.paidMinor, balanceMinor: Math.max(0, total - summary.paidMinor),
    refundMinor: Math.max(0, summary.paidMinor - total), platformFeeMinor: fee };
  if ((record.refunds || []).some(r => r.status !== "CONFIRMED")) throw fail("Complete outstanding refunds before rescheduling.", 409);
  data.reviewToken = createHash("sha256").update(JSON.stringify({ data, booking: String(booking._id),
    updatedAt: venue.updatedAt, revision: record.revision || 0, rescheduleCount: booking.rescheduleCount || 0 })).digest("hex");
  return data;
}
function assertReview(data, token) {
  if (!token || token !== data.reviewToken) throw fail("Booking dates, prices or payments changed. Review the reschedule again.", 409);
}
async function saveAgreement(booking, data, actor, session) {
  const id = `${booking.eventCenter}:${booking._id}`;
  const record = await require("./bookingOperations.service").getRecord(booking.eventCenter, booking, session);
  await Operations.updateOne({ _id: id }, { $set: { agreedPrice: { amount: data.newPriceMinor / 100, currency: data.currency },
    rescheduleAdjustment: true, ...(booking.buyer ? { customerId: booking.buyer } : {}) },
    $setOnInsert: { eventCenter: booking.eventCenter, bookingId: String(booking._id), openingPaidMinor: record.openingPaidMinor },
    $inc: { revision: 1 }, $push: { audit: { action: "RESCHEDULED", actor, at: new Date(), reason: data.approvalRequired === false ? "Client confirmed automatic rescheduling; any extra payment is verified through Paystack and lower-price refunds are settled directly" : "New dates priced; any difference must be settled directly with the customer" } } }, { upsert: true, session });
}
module.exports = { duration, review, assertReview, saveAgreement };
