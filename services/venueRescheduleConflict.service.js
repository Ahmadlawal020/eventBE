const mongoose = require("mongoose");
const Booking = require("../models/client/eventCenterBooking.schema");
const Venue = require("../models/client/eventCenter.schema");
const { assertVenueSchedule } = require("./venueBookingRules.service");
const { dayOf } = require("./bookingAttendance.service");
const { queueNotices } = require("./eventCenterRefundNotifications.service");
const clock = hour => String(hour).padStart(2, "0") + ":00";
function requestedAvailability(booking, venue, now = new Date()) {
  if (!venue) throw Error("Cannot check availability without the venue.");
  const request = booking.rescheduleRequest;
  const check = row => {
    try {
      assertVenueSchedule(venue, [row], booking.bookingUnit, { bookingId: booking._id, now, checkTiming: false });
      return { available: true, reason: null };
    } catch (error) {
      if (![400, 409].includes(error.status || error.statusCode)) throw error;
      return { available: false, reason: error.message };
    }
  };
  const dates = (request?.dates || []).map(row => {
    const date = dayOf(row.date);
    if (booking.bookingUnit !== "hour") return { date, ...check({ date }), hours: [] };
    const start = Number(row.startTime.slice(0, 2));
    const end = row.endTime === "00:00" ? 24 : Number(row.endTime.slice(0, 2));
    const hours = Array.from({ length: end - start }, (_, index) => {
      const slot = { startTime: clock(start + index), endTime: clock(start + index + 1) };
      return { ...slot, ...check({ date, ...slot }) };
    });
    const available = hours.length > 0 && hours.every(hour => hour.available);
    return { date, startTime: row.startTime, endTime: row.endTime, available,
      partial: !available && hours.some(hour => hour.available),
      reason: hours.find(hour => !hour.available)?.reason || null, hours };
  });
  const hasConflict = dates.some(row => !row.available);
  return { requestId: request.id, dates, hasConflict, checkedAt: now };
}
function conflictReason(availability) {
  const conflicts = availability.dates.filter(row => !row.available);
  const labels = conflicts.slice(0, 4).map(row => row.startTime
    ? `${row.date} (${row.hours.filter(hour => !hour.available).map(hour => `${hour.startTime}-${hour.endTime}`).join(", ")})`
    : row.date);
  return `Requested time is no longer available: ${labels.join("; ")}${conflicts.length > 4 ? ` and ${conflicts.length - 4} more dates` : ""}. It conflicts with another reservation, a calendar block, or preparation time. Please choose different dates or hours. Your original booking remains reserved.`;
}
async function recordResolution(booking, session, actor = null) {
  const request = booking.rescheduleRequest;
  await require("../models/client/bookingHistory.schema").create([{
    eventCenter: booking.eventCenter, ticket: booking._id, bookingId: String(booking._id),
    bookingType: "PLATFORM", bookingUnit: booking.bookingUnit, action: "UPDATED", performedBy: actor,
    dates: booking.selectedDates, totalPrice: booking.totalPrice,
    reason: `Reschedule request ${request.id} ${request.status.toLowerCase()}: ${request.resolutionReason}`,
  }], { session });
}
// Only confirmed platform bookings and agreed manual bookings cause automatic cancellation.
// Unpaid checkouts, bookings awaiting review and calendar blocks still block approval.
async function confirmedBookingCalendar(venue, session) {
  const confirmed = await Booking.find({ eventCenter: venue._id, paymentStatus: "COMPLETED",
    status: { $in: ["ACTIVE", "CONFIRMED"] }, paymentResolutionRequired: { $ne: true },
  }).select("_id selectedDates bookingUnit").session(session).lean();
  const candidate = { ...venue, availability: { ...venue.availability } };
  for (const field of ["unavailableDates", "unavailableSlots"])
    candidate.availability[field] = (venue.availability?.[field] || []).filter(entry => entry.type === "MANUAL" && !entry.holdId);
  for (const booking of confirmed) {
    const field = booking.bookingUnit === "hour" ? "unavailableSlots" : "unavailableDates";
    candidate.availability[field].push(...booking.selectedDates.map(row => ({
      date: row.date, ...(booking.bookingUnit === "hour" ? { startTime: row.startTime, endTime: row.endTime } : {}),
      type: "BOOKED", bookingId: String(booking._id),
    })));
  }
  return candidate;
}
async function cancelRequest(booking, venue, confirmedAvailability, session, now) {
  const request = booking.rescheduleRequest;
  request.status = "CANCELLED"; request.resolvedAt = now; request.resolvedBy = null;
  request.resolutionCode = "UNAVAILABLE";
  request.resolutionReason = "Automatically cancelled because another confirmed booking conflicts with the requested time. " + conflictReason(confirmedAvailability);
  request.resolutionAvailability = requestedAvailability(booking, venue, now).dates;
  await booking.save({ session });
  await recordResolution(booking, session);
  await queueNotices([...new Set([String(booking.buyer), String(booking.organiser)])].map(recipient => ({
    key: `reschedule-auto-cancel:${request.id}:${recipient}`, recipient, type: "SYSTEM",
    title: "Rescheduling request cancelled", message: request.resolutionReason,
    data: { screen: recipient === String(booking.buyer) ? "TicketDetails" : "VenueBookingOperations",
      ticketId: String(booking._id), bookingId: String(booking._id), venueId: String(booking.eventCenter) },
  })), session);
}
async function checkPendingRequest(id, requestId, now = new Date()) {
  return mongoose.connection.transaction(async session => {
    const booking = await Booking.findOne({ _id: id, "rescheduleRequest.id": requestId, "rescheduleRequest.status": "PENDING" }).session(session);
    if (!booking) return { skipped: true };
    if (require("./venueReschedulePolicy.service").closeCancelledBookingRequest(booking, booking.cancellation?.actor, now)) {
      await booking.save({ session });
      await recordResolution(booking, session, booking.cancellation?.actor);
      return { cancelled: true };
    }
    const venue = await Venue.findById(booking.eventCenter).session(session).lean();
    if (!venue) return { skipped: true };
    const availability = requestedAvailability(booking, await confirmedBookingCalendar(venue, session), now);
    if (!availability.hasConflict) return { cancelled: false };
    // A concurrent booking cancellation must force a retry of this availability snapshot.
    await Venue.updateOne({ _id: venue._id }, { $inc: { bookingVersion: 1 } }, { session });
    await cancelRequest(booking, venue, availability, session, now);
    return { cancelled: true };
  });
}
async function cancelConflictingRequests(venueId, session) {
  if (!session) throw Error("Reschedule conflict cancellation requires a booking transaction.");
  const pending = await Booking.find({ eventCenter: venueId, "rescheduleRequest.status": "PENDING" }).session(session);
  if (!pending.length) return;
  const venue = await Venue.findById(venueId).session(session).lean();
  const confirmed = await confirmedBookingCalendar(venue, session);
  const now = new Date();
  for (const booking of pending) {
    const availability = requestedAvailability(booking, confirmed, now);
    if (availability.hasConflict) await cancelRequest(booking, venue, availability, session, now);
  }
}
module.exports = { requestedAvailability, conflictReason, recordResolution, checkPendingRequest, cancelConflictingRequests };
