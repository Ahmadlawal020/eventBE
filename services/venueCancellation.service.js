const mongoose = require("mongoose");
const Booking = require("../models/client/eventCenterBooking.schema");
const Venue = require("../models/client/eventCenter.schema");
const Refund = require("../models/client/eventCenterRefund.schema");
const Payout = require("../models/client/venuePayout.schema");
const { bookingSessions } = require("./bookingAttendance.service");
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const { queueNotices } = require("./eventCenterRefundNotifications.service");

function cancellationTerms(booking, now = new Date()) {
  const policy = booking.cancellationPolicy || {};
  const sessions = bookingSessions(booking);
  const startsAt = sessions.length ? new Date(Math.min(...sessions.map(s => +new Date(s.startsAt)))) : null;
  const noticeHours = policy.noticeHours ?? 24;
  const deadline = startsAt ? new Date(+startsAt - noticeHours * 3600000) : null;
  const active = ["ACTIVE", "CONFIRMED"].includes(booking.status) && booking.paymentStatus === "COMPLETED" &&
    !booking.paymentResolutionRequired && !booking.checkIn?.isCheckedIn && !booking.refund?.state;
  const canOrganiserCancel = Boolean(active && startsAt && now < startsAt);
  return { policy, deadline, canOrganiserCancel,
    canGuestCancel: Boolean(canOrganiserCancel && policy.allowGuestCancellation === true && deadline && now <= deadline) };
}
function refundAmount(booking) {
  const amount = booking.subtotalPrice?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 ||
      amount > booking.totalPrice.amount || !Number.isSafeInteger(Math.round(amount * 100)))
    throw fail("This booking needs a price review by support before cancellation.", 409);
  return Math.round(amount * 100);
}
async function preview(booking, guest = false) {
  const terms = cancellationTerms(booking);
  const payout = await Payout.findOne({ booking: booking._id }).lean();
  const funded = booking.bookingMode !== "REVIEW" || payout?.status === "SUCCESS";
  let amount = null;
  try { amount = refundAmount(booking); } catch {}
  return { ...terms, payoutStatus: payout?.status || null, canCancel: (guest ? terms.canGuestCancel : terms.canOrganiserCancel) && funded && amount !== null,
    refundMinor: amount, currency: booking.totalPrice.currency,
    terms: "The organiser refunds the booking price directly within " + (terms.policy.refundDays || 7) +
      " days. Platform fees are excluded. Submit bank details from your ticket, then confirm only after receiving the money.",
    unavailableReason: !funded ? "The booking payout is still being resolved. Refresh shortly or contact support." :
      amount === null ? "This booking needs a price review by support." : "Cancellation is unavailable or its deadline has passed." };
}
async function cancel(id, { actor, guest = false, reason = "", expectedRefundMinor } = {}) {
  if (typeof reason !== "string" || reason.length > 1000) throw fail("Keep the cancellation reason under 1000 characters.");
  return mongoose.connection.transaction(async session => {
    const booking = await Booking.findById(id).session(session);
    if (!booking) throw fail("Booking not found.", 404);
    const owner = guest ? booking.buyer : booking.organiser;
    if (String(owner) !== String(actor)) throw fail("You cannot cancel this booking.", 403);
    if (booking.status === "CANCELLED") return booking;
    const terms = cancellationTerms(booking);
    if (!(guest ? terms.canGuestCancel : terms.canOrganiserCancel))
      throw fail(guest ? "Cancellation is not allowed or the cancellation deadline has passed." : "Only paid bookings that have not started can be cancelled.", 409);
    const payout = await Payout.findOne({ booking: id }).session(session);
    if (booking.bookingMode === "REVIEW" && payout?.status !== "SUCCESS")
      throw fail("The booking payout is still being resolved. Refresh shortly or contact support.", 409);
    const amountMinor = refundAmount(booking);
    if (expectedRefundMinor !== undefined && expectedRefundMinor !== amountMinor) throw fail("The refund amount changed. Refresh before cancelling.", 409);
    const venue = await Venue.findById(booking.eventCenter).session(session);
    if (!venue) throw fail("Venue not found.", 404);
    const now = new Date();
    booking.status = "CANCELLED";
    require("./venueReschedulePolicy.service").closeCancelledBookingRequest(booking, actor, now);
    booking.cancellation = { at: now, actor, reason: reason.trim(), refundMode: "DIRECT" };
    await booking.save({ session });
    if (amountMinor > 0) await Refund.create([{
      resourceTitle: venue.venueName, eventCenterId: venue._id, bookingId: booking._id, ticketId: booking._id,
      buyer: booking.buyer, originalBuyer: booking.transferHistory?.[0]?.fromUser || booking.buyer,
      organiser: booking.organiser, amountMinor, currency: booking.totalPrice.currency,
      dueAt: new Date(+now + (terms.policy.refundDays || 7) * 86400000),
    }], { session });
    await Venue.updateOne({ _id: venue._id }, { $pull: {
      "availability.unavailableDates": { bookingId: String(id) },
      "availability.unavailableSlots": { bookingId: String(id) },
    } }, { session });
    await require("../models/client/bookingHistory.schema").create([{
      eventCenter: venue._id, ticket: id, bookingId: String(id), bookingType: "PLATFORM",
      bookingUnit: booking.bookingUnit, action: "CANCELLED", performedBy: actor,
      dates: booking.selectedDates, totalPrice: booking.totalPrice, reason: reason.trim(),
    }], { session });
    await queueNotices([
      { key: "venue-direct-cancelled:" + id, recipient: booking.buyer, type: "BOOKING_CANCELLED",
        title: "Booking cancelled", message: amountMinor ? "Open your event center ticket to submit bank details and track your direct refund." : "Your event center booking was cancelled. No payment refund is due.",
        data: { screen: "Tickets", ticketId: String(id) } },
      { key: "venue-direct-refund:" + id, recipient: booking.organiser, type: "SYSTEM",
        title: "Event center booking cancelled", message: amountMinor ? "A booking-price refund is due. Open the booking refund to arrange direct payment." : "The booking was cancelled. No refund is due.",
        data: { screen: "OrganiserVenueRefund", bookingId: String(id) } },
    ], session);
    return booking;
  });
}
module.exports = { cancellationTerms, refundAmount, preview, cancel };
