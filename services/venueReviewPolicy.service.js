const { bookingSessions } = require("./bookingAttendance.service");
function firstBookingStart(booking) {
  const sessions = bookingSessions(booking);
  return sessions.length ? new Date(Math.min(...sessions.map(s => +new Date(s.startsAt)))) : null;
}
function reviewDeadline(booking, now = new Date()) {
  const starts = firstBookingStart(booking);
  if (!starts) throw Object.assign(new Error("Select a valid booking session."), { statusCode: 409 });
  return new Date(Math.min(+starts, booking.reviewDeadline ? +new Date(booking.reviewDeadline) : +now + 86400000));
}
function assertReviewOpen(booking, now = new Date()) {
  if (+reviewDeadline(booking, now) <= +now)
    throw Object.assign(new Error("The approval deadline or booked start time has passed."), { statusCode: 409 });
}
module.exports = { firstBookingStart, reviewDeadline, assertReviewOpen };
