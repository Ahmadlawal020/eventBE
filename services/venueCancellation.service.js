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
async function adjustedRefund(booking, session = null) {
  if (booking.rescheduleCheckoutId) throw fail("Finish or check the pending reschedule payment before cancelling.", 409);
  const record = await require("../models/client/bookingOperations.schema").findById(`${booking.eventCenter}:${booking._id}`).session(session).lean();
  if (!record?.rescheduleAdjustment) return refundAmount(booking);
  if ((record.refunds || []).some(r => r.status !== "CONFIRMED")) throw fail("Complete the outstanding reschedule refund before cancelling.", 409);
  const adjustment = (record.payments || []).reduce((sum, p) => sum + (p.kind === "PAYMENT" ? p.amountMinor - (p.platformFeeMinor || 0) : p.kind === "REFUND" ? -p.amountMinor : 0), 0);
  return Math.max(0, refundAmount(booking) + adjustment);
}
async function preview(booking, guest = false) {
  const terms = cancellationTerms(booking);
  const payout = await Payout.findOne({ booking: booking._id }).lean();
  const payoutInFlight = booking.bookingMode === "REVIEW" && payout && ["PREPARING", "SUBMITTING", "PENDING"].includes(payout.status);
  let amount = null;
  let priceError;
  try { amount = await adjustedRefund(booking); } catch (error) { priceError = error.message; }
  const providerRefund = booking.bookingMode === "REVIEW" && (!payout || ["READY", "FAILED", "NEEDS_ATTENTION", "CANCELLED"].includes(payout.status));
  const maxDays = terms.policy.refundDays || 7;
  const minDays = terms.policy.refundMinDays != null ? Math.min(terms.policy.refundMinDays, maxDays) : maxDays;
  const deadlineText = minDays < maxDays ? `${minDays}-${maxDays} days` : `${maxDays} ${maxDays === 1 ? "day" : "days"}`;
  return { ...terms, payoutStatus: payout?.status || null, canCancel: (guest ? terms.canGuestCancel : terms.canOrganiserCancel) && !payoutInFlight && amount !== null,
    refundMinor: amount, currency: booking.totalPrice.currency,
    terms: providerRefund
      ? "The booking payout has not been settled to the organiser yet. Cancelling will queue a full provider refund of the collected payment."
      : "The organiser refunds the booking price directly within " + deadlineText +
        ". Platform fees are excluded. Submit bank details from your ticket, then confirm only after receiving the money.",
    unavailableReason: payoutInFlight ? "The booking payout is currently in flight with the payment provider. Refresh shortly or contact support." :
      amount === null ? priceError || "This booking needs a price review by support." : "Cancellation is unavailable or its deadline has passed." };
}
async function cancel(id, { actor, guest = false, reason = "", expectedRefundMinor, adminOverride = false } = {}) {
  if (typeof reason !== "string" || reason.length > 1000) throw fail("Keep the cancellation reason under 1000 characters.");
  return mongoose.connection.transaction(async session => {
    const booking = await Booking.findById(id).session(session);
    if (!booking) throw fail("Booking not found.", 404);
    const owner = guest ? booking.buyer : booking.organiser;
    if (!adminOverride && String(owner) !== String(actor)) throw fail("You cannot cancel this booking.", 403);
    if (booking.status === "CANCELLED") return booking;
    const terms = cancellationTerms(booking);
    if (!adminOverride && !(guest ? terms.canGuestCancel : terms.canOrganiserCancel))
      throw fail(guest ? "Cancellation is not allowed or the cancellation deadline has passed." : "Only paid bookings that have not started can be cancelled.", 409);
    if (adminOverride && (!["ACTIVE", "CONFIRMED"].includes(booking.status) || booking.paymentStatus !== "COMPLETED"))
      throw fail("Only active or confirmed paid bookings can be cancelled.", 409);
    const payout = await Payout.findOne({ booking: id }).session(session);
    if (booking.bookingMode === "REVIEW" && payout && ["PREPARING", "SUBMITTING", "PENDING"].includes(payout.status))
      throw fail("The booking payout is currently in flight with the payment provider. Resolve the payout before cancelling.", 409);
    const useProviderRefund = booking.bookingMode === "REVIEW" && (!payout || ["READY", "FAILED", "NEEDS_ATTENTION", "CANCELLED"].includes(payout.status));
    if (useProviderRefund) {
      if (payout && payout.status !== "CANCELLED") {
        payout.status = "CANCELLED";
        payout.lastError = "Cancelled before payout settlement due to booking cancellation";
        await payout.save({ session });
      }
      const providerRefundMinor = booking.paymentStatus === "COMPLETED" && booking.paymentReference ? Math.round(booking.totalPrice.amount * 100) : 0;
      const venue = await Venue.findById(booking.eventCenter).session(session);
      if (!venue) throw fail("Venue not found.", 404);
      const now = new Date();
      booking.status = "CANCELLED";
      booking.cancellation = { at: now, actor, mode: "cancel", ...(reason.trim() ? { reason: reason.trim() } : {}) };
      require("./venueReschedulePolicy.service").closeCancelledBookingRequest(booking, actor, now);
      if (providerRefundMinor) {
        booking.paymentResolutionRequired = true;
        booking.refund = { state: "QUEUED", requestedAt: now, amountMinor: providerRefundMinor };
      }
      await booking.save({ session });
      await Venue.updateOne({ _id: venue._id }, { $pull: {
        "availability.unavailableDates": { bookingId: String(id) },
        "availability.unavailableSlots": { bookingId: String(id) },
      } }, { session });
      await require("../models/client/bookingHistory.schema").create([{
        eventCenter: venue._id, ticket: id, bookingId: String(id), bookingType: "PLATFORM",
        bookingUnit: booking.bookingUnit, action: "CANCELLED", performedBy: actor,
        dates: booking.selectedDates, totalPrice: booking.rescheduledPrice || booking.totalPrice, refundMinor: providerRefundMinor, reason: reason.trim(),
      }], { session });
      const providerNotices = [{
        key: "venue-cancelled:" + id, recipient: booking.buyer, type: "BOOKING_CANCELLED",
        title: "Booking cancelled", message: providerRefundMinor ? "Your booking was cancelled before organiser payout. Your refund has been queued with the payment provider." : "Your booking was cancelled.",
        data: { screen: "TicketDetails", ticketId: String(id), bookingId: String(id) },
      }];
      const hostRecipients = [...new Set([booking.organiser, ...(venue.coOrganisers || [])].filter(Boolean).map(String))]
        .filter((r) => guest || r !== String(actor));
      for (const recipient of hostRecipients) {
        providerNotices.push({
          key: `venue-cancelled-host:${id}:${recipient}`,
          recipient,
          type: "BOOKING_CANCELLED",
          title: "Event center booking cancelled",
          message: providerRefundMinor
            ? `${venue.venueName || "Venue"}: a booking was cancelled before payout and a provider refund was queued.`
            : `${venue.venueName || "Venue"}: a booking was cancelled.`,
          data: { screen: "OrganiserVenueRefund", bookingId: String(id), venueId: String(venue._id) },
        });
      }
      await queueNotices(providerNotices, session);
      return booking;
    }
    const amountMinor = await adjustedRefund(booking, session);
    if (expectedRefundMinor !== undefined && expectedRefundMinor !== amountMinor) throw fail("The refund amount changed. Refresh before cancelling.", 409);
    const venue = await Venue.findById(booking.eventCenter).session(session);
    if (!venue) throw fail("Venue not found.", 404);
    const now = new Date();
    booking.status = "CANCELLED";
    require("./venueReschedulePolicy.service").closeCancelledBookingRequest(booking, actor, now);
    booking.cancellation = { at: now, actor, mode: "cancel", reason: reason.trim(), refundMode: "DIRECT" };
    await booking.save({ session });
    const [createdRefund] = amountMinor > 0 ? await Refund.create([{
      resourceTitle: venue.venueName, eventCenterId: venue._id, bookingId: booking._id, ticketId: booking._id,
      buyer: booking.buyer, originalBuyer: booking.transferHistory?.[0]?.fromUser || booking.buyer,
      organiser: booking.organiser, amountMinor, currency: booking.totalPrice.currency,
      dueAt: new Date(+now + (terms.policy.refundDays || 7) * 86400000),
    }], { session }) : [];
    await Venue.updateOne({ _id: venue._id }, { $pull: {
      "availability.unavailableDates": { bookingId: String(id) },
      "availability.unavailableSlots": { bookingId: String(id) },
    } }, { session });
    await require("../models/client/bookingHistory.schema").create([{
      eventCenter: venue._id, ticket: id, bookingId: String(id), bookingType: "PLATFORM",
      bookingUnit: booking.bookingUnit, action: "CANCELLED", performedBy: actor,
      dates: booking.selectedDates, totalPrice: booking.rescheduledPrice || booking.totalPrice, refundMinor: amountMinor, reason: reason.trim(),
    }], { session });
    const directNotices = [
      { key: "venue-direct-cancelled:" + id, recipient: booking.buyer, type: "BOOKING_CANCELLED",
        title: "Booking cancelled", message: amountMinor ? "Open your refund details to submit bank details and track your direct refund." : "Your event center booking was cancelled. No payment refund is due.",
        data: createdRefund
          ? { screen: "VenueRefundDetails", refundId: String(createdRefund._id), ticketId: String(id), bookingId: String(id) }
          : { screen: "TicketDetails", ticketId: String(id), bookingId: String(id) } },
    ];
    const directHostRecipients = [...new Set([booking.organiser, ...(venue.coOrganisers || [])].filter(Boolean).map(String))];
    for (const recipient of directHostRecipients) {
      directNotices.push({
        key: recipient === String(booking.organiser) ? "venue-direct-refund:" + id : `venue-direct-refund:${id}:${recipient}`,
        recipient,
        type: "SYSTEM",
        title: "Event center booking cancelled",
        message: amountMinor ? "A booking-price refund is due. Open the booking refund to arrange direct payment." : "The booking was cancelled. No refund is due.",
        data: { screen: "OrganiserVenueRefund", bookingId: String(id), ...(createdRefund ? { refundId: String(createdRefund._id) } : {}) },
      });
    }
    await queueNotices(directNotices, session);
    return booking;
  });
}
module.exports = { cancellationTerms, refundAmount, adjustedRefund, preview, cancel };
