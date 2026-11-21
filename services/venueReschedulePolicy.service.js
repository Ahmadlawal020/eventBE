const { bookingSessions } = require("./bookingAttendance.service");
function rescheduleAllowance(booking) {
  const maxReschedules = booking.cancellationPolicy?.maxReschedules ?? null;
  const rescheduleCount = booking.rescheduleCount ?? 0;
  const valid = Number.isSafeInteger(rescheduleCount) && rescheduleCount >= 0 &&
    (maxReschedules === null || (Number.isInteger(maxReschedules) && maxReschedules >= 1 && maxReschedules <= 100));
  const remainingReschedules = maxReschedules === null ? null : Math.max(0, maxReschedules - rescheduleCount);
  const limitReached = !valid || remainingReschedules === 0;
  return { maxReschedules, rescheduleCount, remainingReschedules, limitReached };
}
function rescheduleTerms(booking, now = new Date()) {
  const policy = booking.cancellationPolicy || {};
  // Legacy bookings allowed requests until the session started; retain those terms.
  const allowed = policy.allowGuestReschedule !== false;
  const noticeHours = policy.rescheduleNoticeHours ?? 0;
  const allowance = rescheduleAllowance(booking);
  const sessions = bookingSessions(booking);
  const startsAt = sessions.length ? new Date(Math.min(...sessions.map(s => +new Date(s.startsAt)))) : null;
  const validNotice = Number.isInteger(noticeHours) && noticeHours >= 0 && noticeHours <= 8760;
  const deadline = startsAt && validNotice ? new Date(+startsAt - noticeHours * 3600000) : null;
  const active = ["ACTIVE", "CONFIRMED"].includes(booking.status) && booking.paymentStatus === "COMPLETED" &&
    !booking.rescheduleCheckoutId && !booking.paymentResolutionRequired && !booking.refund?.state && !booking.checkIn?.isCheckedIn;
  const future = startsAt && now < startsAt;
  const pending = booking.rescheduleRequest?.status === "PENDING";
  const canRequest = Boolean(allowed && active && future && deadline && now <= deadline && !pending && !allowance.limitReached);
  const reason = !allowed ? "The organiser does not allow rescheduling requests for this booking." :
    !active || !future ? "Only paid bookings that have not started can request a date change." :
    allowance.limitReached ? "This booking has used all its allowed reschedules." :
    pending ? "Withdraw your pending request before submitting another." :
    !deadline || now > deadline ? "The notice deadline for requesting a date change has passed." : null;
  return { canRequest, deadline, allowed, noticeHours, reason, ...allowance };
}
// Persist this with the booking cancellation so a pending request cannot outlive it.
function closeCancelledBookingRequest(booking, actor = null, now = new Date()) {
  if (booking.status !== "CANCELLED" || booking.rescheduleRequest?.status !== "PENDING") return false;
  Object.assign(booking.rescheduleRequest, {
    status: "CANCELLED", resolvedAt: now, resolvedBy: actor,
    resolutionCode: "BOOKING_CANCELLED",
    resolutionReason: "The original booking was cancelled, so this reschedule request is closed. See the booking for cancellation and refund details.",
  });
  return true;
}
module.exports = { rescheduleAllowance, rescheduleTerms, closeCancelledBookingRequest };
