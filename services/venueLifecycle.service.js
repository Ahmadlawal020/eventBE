const mongoose = require("mongoose");
const Booking = require("../models/client/eventCenterBooking.schema");
const Venue = require("../models/client/eventCenter.schema");
const Payout = require("../models/client/venuePayout.schema");
const History = require("../models/client/bookingHistory.schema");
const { fail, venueQuote } = require("./checkoutSafety.service");
const { bookingSessions } = require("./bookingAttendance.service");
function assertFutureBooking(booking) {
  const sessions = bookingSessions(booking);
  if (!sessions.length || sessions.some(s => new Date(s.startsAt) <= new Date()) || booking.checkIn?.isCheckedIn)
    throw fail("Started bookings require support review and cannot be changed automatically.", 409);
}
async function history(booking, action, actor, session, extra = {}) {
  await History.create([{ eventCenter: booking.eventCenter, ticket: booking._id,
    bookingId: String(booking._id), bookingType: "PLATFORM", bookingUnit: booking.bookingUnit,
    action, performedBy: actor, dates: booking.selectedDates, totalPrice: booking.totalPrice,
    guestName: booking.guestDetails?.fullName, ...extra }], { session });
}
async function cancelVenueBooking(id, { actor = null, mode = "cancel", reason, expectedRefundMinor } = {}) {
  return mongoose.connection.transaction(async session => {
    const booking = await Booking.findById(id).session(session);
    if (!booking) throw fail("Booking not found.", 404);
    if (mode === "withdraw" && String(booking.buyer) !== String(actor)) throw fail("Only the guest can withdraw this request.", 403);
    if (booking.status === "CANCELLED") return booking;
    if (mode === "cancel") {
      if (!["ACTIVE", "CONFIRMED"].includes(booking.status)) throw fail("Only active or confirmed bookings can be cancelled.", 409);
      assertFutureBooking(booking);
    } else {
      if (booking.status !== "PENDING_REVIEW") throw fail("This booking is no longer awaiting review.", 409);
      if (mode === "expire" && require("./venueReviewPolicy.service").reviewDeadline(booking) > new Date()) throw fail("Review deadline has not passed.", 409);
    }
    const payout = await Payout.findOne({ booking: id }).session(session);
    if (payout && payout.status !== "CANCELLED") {
      if (payout.status !== "READY" || payout.leaseUntil > new Date()) throw fail("Payout has started. Contact support to reconcile the payout before cancellation.", 409);
      payout.status = "CANCELLED";
      await payout.save({ session });
    }
    const refundMinor = booking.paymentStatus === "COMPLETED" && booking.paymentReference ? Math.round(booking.totalPrice.amount * 100) : 0;
    if (expectedRefundMinor !== undefined && expectedRefundMinor !== refundMinor) throw fail("The refund amount changed. Review cancellation again.", 409);
    booking.status = "CANCELLED";
    require("./venueReschedulePolicy.service").closeCancelledBookingRequest(booking, actor);
    booking.reviewedAt = new Date();
    if (refundMinor) booking.paymentResolutionRequired = true;
    if (refundMinor) booking.refund = { state: "QUEUED", requestedAt: new Date(), amountMinor: refundMinor };
    await booking.save({ session });
    await Venue.updateOne({ _id: booking.eventCenter }, { $pull: {
      "availability.unavailableDates": { bookingId: String(id) },
      "availability.unavailableSlots": { bookingId: String(id) },
    } }, { session });
    await history(booking, mode === "decline" ? "DECLINED" : "CANCELLED", actor, session, { reason });
    await require("./eventCenterRefundNotifications.service").queueNotices([{
      key: "venue-cancelled:" + id, recipient: booking.buyer, type: "BOOKING_CANCELLED",
      title: "Booking cancelled", message: refundMinor ? "Your booking was cancelled. Your refund has been queued; completion will be confirmed separately." : "Your booking was cancelled.",
      data: { screen: "BookingDetails", ticketId: String(id) },
    }], session);
    return booking;
  });
}
// Both the organiser preview and final transactional approval use these checks.
// Only this booking's own reservations may be excluded from conflict detection.
async function quoteReschedule(booking, venue, dates) {
  if (!booking || !["ACTIVE", "CONFIRMED"].includes(booking.status) || booking.paymentStatus !== "COMPLETED")
    throw fail("Only paid active bookings can be rescheduled.", 409);
  if (booking.paymentResolutionRequired || booking.refund?.state)
    throw fail("Resolve this booking payment or refund before rescheduling.", 409);
  if (require("./venueReschedulePolicy.service").rescheduleAllowance(booking).limitReached)
    throw fail("This booking has used all its allowed reschedules.", 409);
  assertFutureBooking(booking);
  if (!venue || venue.status !== "LISTED" || venue.archivedAt) throw fail("Venue is not accepting bookings.", 409);
  const candidate = venue.toObject ? venue.toObject() : { ...venue, availability: { ...venue.availability } };
  for (const key of ["unavailableDates", "unavailableSlots"])
    candidate.availability[key] = (candidate.availability[key] || []).filter(entry => String(entry.bookingId) !== String(booking._id));
  const quote = venueQuote(candidate, { selectedDates: dates, bookingUnit: booking.bookingUnit });
  await require("./venueCalendarMutation.service").validateManualBookingWindow(quote.selectedDates);
  if (quote.duration !== booking.duration || quote.currency !== booking.totalPrice.currency || Math.round(quote.subtotalAmount * 100) !== Math.round((booking.subtotalPrice?.amount ?? NaN) * 100))
    throw fail("Rescheduling must preserve the paid duration and price. Cancel and rebook to change the price or duration.", 409);
  return { candidate, quote };
}
async function rescheduleVenueBooking(id, dates, actor, requestId) {
  return mongoose.connection.transaction(async session => {
    const booking = await Booking.findById(id).session(session);
    if (!booking || !["ACTIVE", "CONFIRMED"].includes(booking.status) || booking.paymentStatus !== "COMPLETED") throw fail("Only paid active bookings can be rescheduled.", 409);
    assertFutureBooking(booking);
    const venue = await Venue.findById(booking.eventCenter).session(session);
    if (!venue || venue.status !== "LISTED") throw fail("Venue is not accepting bookings.", 409);
    await require("./venueAccess.service").requireVenuePermission(actor, venue, ["MANAGE_CALENDAR"]);
    if (requestId && (booking.rescheduleRequest?.id !== requestId || booking.rescheduleRequest.status !== "PENDING")) throw fail("This reschedule request has changed.", 409);
    if (requestId) dates = booking.rescheduleRequest.dates.map(d => d.toObject());
    // Re-read and validate inside the transaction; a review preview never reserves inventory.
    // Saving the same venue document as checkout forces concurrent writers to retry.
    const { candidate, quote } = await quoteReschedule(booking, venue, dates);
    const previousDates = booking.selectedDates.map(d => d.toObject());
    booking.selectedDates = quote.selectedDates;
    booking.rescheduleCount = (booking.rescheduleCount ?? 0) + 1;
    if (booking.rescheduleRequest?.status === "PENDING") {
      booking.rescheduleRequest.status = requestId ? "ACCEPTED" : "DECLINED";
      booking.rescheduleRequest.resolvedAt = new Date(); booking.rescheduleRequest.resolvedBy = actor;
      if (!requestId) {
        booking.rescheduleRequest.resolutionCode = "SUPERSEDED";
        booking.rescheduleRequest.resolutionReason = "The organiser moved the booking to different dates. Review your updated booking schedule.";
      }
    }
    for (const key of ["unavailableDates", "unavailableSlots"]) venue.availability[key] = candidate.availability[key];
    const field = booking.bookingUnit === "day" ? "unavailableDates" : "unavailableSlots";
    venue.availability[field].push(...quote.selectedDates.map(d => ({ ...d, type: "BOOKED", bookingId: String(id), clientName: booking.guestDetails?.fullName, clientPhone: booking.guestDetails?.phoneNumber, clientEmail: booking.guestDetails?.email })));
    await venue.save({ session });
    await booking.save({ session });
    await require("./venueBookingEvents.service").recordVenueEvent(booking, "RESCHEDULED", actor, session, { previousDates });
    return booking;
  });
}
async function archiveVenue(id, actor) {
  return mongoose.connection.transaction(async session => {
    const venue = await Venue.findById(id).session(session);
    if (!venue) throw fail("Venue not found.", 404);
    if (String(venue.createdBy) !== String(actor)) throw fail("Only the owner can remove this listing.", 403);
    if (await Booking.exists({ eventCenter: id, $or: [{ status: { $in: ["ACTIVE", "CONFIRMED", "PENDING_REVIEW"] } }, { paymentStatus: "FAILED_REFUND" }, { paymentResolutionRequired: true }, { "refund.state": { $in: ["QUEUED", "SUBMITTING", "PENDING", "NEEDS_ATTENTION"] } }] }).session(session)) throw fail("Resolve outstanding bookings and refunds before removing this venue.", 409);
    if (await require("../models/client/eventCenterRefund.schema").exists({ eventCenterId: id, status: { $ne: "CONFIRMED_BY_BUYER" } }).session(session))
      throw fail("Resolve outstanding direct refunds before removing this venue.", 409);
    const records = await require("../models/client/bookingOperations.schema").find({ eventCenter: id }).session(session).lean();
    if (records.some(r => (r.refunds || []).some(f => f.status !== "CONFIRMED"))) throw fail("Resolve outstanding manual refunds before removing this venue.", 409);
    const manualHistory = await History.find({ eventCenter: id, bookingType: "MANUAL" }).session(session).lean();
    const snapshots = records.filter(r => r.bookingSnapshot && !manualHistory.some(h => h.bookingId === r.bookingId && h.action === "CREATED"))
      .map(r => ({ ...r.bookingSnapshot, eventCenter: id, bookingId: r.bookingId, bookingType: "MANUAL", action: "CREATED", createdAt: r.createdAt }));
    const manual = require("./manualBookingRead.service").buildManualBookings([venue.toObject()], [...manualHistory, ...snapshots]);
    for (const booking of manual) {
      const record = records.find(r => r.bookingId === booking.bookingId);
      const money = require("./venueMoney.service").manualMoney(booking, record);
      const security = require("./bookingOperations.service").paymentSummary(booking, record).securityMinor;
      if ((booking.status === "CANCELLED" && money.netCollectedMinor > 0) || security > 0) throw fail("Resolve manual refund balances and held security deposits before removing this venue.", 409);
    }
    const now = new Date();
    const entries = [...(venue.availability?.unavailableDates || []), ...(venue.availability?.unavailableSlots || [])];
    if (entries.some(entry => (entry.type === "MANUAL" && !entry.holdId) && bookingSessions({ selectedDates: [entry], bookingUnit: entry.startTime ? "hour" : "day" }).some(item => new Date(item.endsAt) > now))) throw fail("Resolve upcoming manual bookings before removing this venue.", 409);
    const ids = await Booking.find({ eventCenter: id }).select("_id").session(session).lean();
    if (await Payout.exists({ booking: { $in: ids.map(b => b._id) }, status: { $in: ["READY", "PREPARING", "SUBMITTING", "PENDING", "NEEDS_ATTENTION"] } }).session(session)) throw fail("Resolve outstanding payouts before removing this venue.", 409);
    venue.status = "UNLISTED";
    venue.archivedAt = new Date();
    await venue.save({ session });
    return venue;
  });
}
module.exports = { cancelVenueBooking, rescheduleVenueBooking, archiveVenue, assertFutureBooking, quoteReschedule };
