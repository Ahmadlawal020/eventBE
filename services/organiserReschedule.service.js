const mongoose = require("mongoose");
const Venue = require("../models/client/eventCenter.schema");
const Booking = require("../models/client/eventCenterBooking.schema");
const finance = require("./venueRescheduleFinance.service");
const { fail, venueQuote } = require("./checkoutSafety.service");
async function prepare(id, venueId, dates, actor, session = null) {
  const manual = /^manual-[a-zA-Z0-9_-]{1,100}$/.test(String(id));
  if ((!manual && !mongoose.isValidObjectId(id)) || (manual && !mongoose.isValidObjectId(venueId))) throw fail("Invalid booking reference.");
  let booking = manual ? null : await Booking.findById(id).session(session);
  const venue = await Venue.findById(manual ? venueId : booking?.eventCenter).session(session).lean();
  if (!venue || (!manual && !booking)) throw fail("Booking not found.", 404);
  if (venue.archivedAt) throw fail("Archived venues cannot be rescheduled.", 409);
  await require("./venueAccess.service").requireVenuePermission(actor, venue, ["MANAGE_CALENDAR"]);
  await require("./venueAccess.service").requireVenuePermission(actor, venue, ["VIEW_FINANCES"]);
  let quote, candidate, warnings;
  if (manual) {
    const rows = [ ...(venue.availability?.unavailableDates || []), ...(venue.availability?.unavailableSlots || []) ].filter(r => r.type === "MANUAL" && r.bookingId === id);
    if (!rows.length) throw fail("Manual booking not found.", 404);
    const record = await require("../models/client/bookingOperations.schema").findById(`${venue._id}:${id}`).session(session).lean();
    const unit = record?.bookingSnapshot?.bookingUnit || rows[0].bookingUnit || venue.basePrice.unit;
    booking = { _id: id, eventCenter: venue._id, bookingType: "MANUAL", bookingUnit: unit, selectedDates: rows,
      totalPrice: { amount: rows[0].totalPrice, currency: record?.agreedPrice?.currency || record?.bookingSnapshot?.totalPrice?.currency || rows[0].currency || venue.basePrice.currency },
      depositAmount: rows[0].depositAmount, paymentStatus: rows[0].paymentStatus === "paid" ? "COMPLETED" : "PENDING", status: "CONFIRMED" };
    require("./venueLifecycle.service").assertFutureBooking(booking);
    candidate = { ...venue, availability: { ...venue.availability } };
    for (const field of ["unavailableDates", "unavailableSlots"]) candidate.availability[field] = (candidate.availability[field] || []).filter(r => r.bookingId !== id);
    quote = venueQuote(candidate, { selectedDates: dates, bookingUnit: unit }, { organiserOverride: true });
    if (quote.currency !== booking.totalPrice.currency) throw fail("Rescheduling cannot change the booking currency.", 409);
    if (quote.duration !== finance.duration(rows, unit)) throw fail("Rescheduling must keep the original number of days or hours.", 409);
    warnings = await require("./organiserScheduleWarnings.service").getWarnings(candidate, quote.selectedDates, unit);
    const summary = require("./bookingOperations.service").paymentSummary(booking, record || {});
    const field = unit === "hour" ? "unavailableSlots" : "unavailableDates";
    candidate.availability[field].push(...quote.selectedDates.map(d => ({ ...rows[0], ...d, totalPrice: quote.subtotalAmount,
      depositAmount: summary.paidMinor / 100, paymentStatus: summary.paidMinor >= Math.round(quote.subtotalAmount * 100) ? "paid" : summary.paidMinor > 0 ? "partially_paid" : "pending" })));
  } else {
    ({ quote, candidate, warnings } = await require("./venueLifecycle.service").quoteReschedule(booking, venue, dates, { allowPriceChange: true, allowAvailabilityOverride: true }));
  }
  const record = await require("./bookingOperations.service").getRecord(venue._id, booking, session);
  return { booking, venue, candidate, quote, review: finance.review(booking, venue, quote, record, warnings) };
}
async function commit(id, venueId, dates, actor, options) {
  if (options.reason !== undefined && (typeof options.reason !== "string" || options.reason.length > 500)) throw fail("Keep the reschedule reason under 500 characters.");
  if (!String(id).startsWith("manual-")) return require("./venueLifecycle.service").rescheduleVenueBooking(id, dates, actor, undefined, options);
  return mongoose.connection.transaction(async session => {
    const data = await prepare(id, venueId, dates, actor, session);
    finance.assertReview(data.review, options.reviewToken);
    await require("./venueCalendarMutation.service").syncManualBookings(data.venue, data.candidate, actor, session, { rescheduleReview: data.review, reason: options.reason });
    await finance.saveAgreement(data.booking, data.review, actor, session);
    await Venue.updateOne({ _id: data.venue._id }, { $set: { availability: data.candidate.availability } }, { session, runValidators: true });
    await require("./venueRescheduleConflict.service").cancelConflictingRequests(data.venue._id, session);
    return data.review;
  });
}
module.exports = { prepare, commit };
