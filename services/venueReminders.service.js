const { dayOf } = require("./bookingAttendance.service");
const { paymentSummary } = require("./bookingOperations.service");
function reminderCandidates(venue, bookings, records = [], now = new Date()) {
  const result = [];
  const add = (booking, recipient, kind, suffix, message, client = false) => {
    if (!recipient) return;
    result.push({ key: `${venue._id}:${booking._id}:${recipient}:${kind}:${suffix}`, recipient: String(recipient),
      type: kind, title: kind === "VENUE_PAYMENT_DUE" ? "Booking payment due" : kind === "VENUE_ATTENDANCE_FOLLOWUP" ? "Confirm session attendance" : "Upcoming venue booking",
      message, data: { screen: client ? "TicketDetails" : "VenueBookingOperations", type: "EVENT_CENTER", bookingId: String(booking._id), ticketId: String(booking._id), venueId: String(venue._id) } });
  };
  for (const booking of bookings) {
    if (!["ACTIVE", "CONFIRMED", "COMPLETED"].includes(booking.status)) continue;
    for (const session of booking.attendance.sessions) {
      const until = new Date(session.startsAt) - now;
      if (until > 0 && until <= 24 * 3600000) {
        const suffix = `${session.sessionId}:${until <= 2 * 3600000 ? "2H" : "24H"}`;
        const message = `${venue.venueName}: booking on ${session.date}${session.allDay ? "" : ` at ${session.startTime}`}.`;
        add(booking, venue.createdBy, "VENUE_SESSION_REMINDER", suffix, message);
        if (booking.buyer && String(booking.buyer) !== String(venue.createdBy)) add(booking, booking.buyer, "VENUE_SESSION_REMINDER", suffix, message, true);
      }
      if (session.status === "UNCONFIRMED" && now - new Date(session.endsAt) <= 7 * 86400000) {
        add(booking, venue.createdBy, "VENUE_ATTENDANCE_FOLLOWUP", session.sessionId, `${venue.venueName}: confirm attendance for the session on ${session.date}.`);
      }
    }
    const record = records.find(r => r.bookingId === String(booking._id)) || {};
    const summary = paymentSummary(booking, record);
    if (summary.balanceMinor > 0 && record.paymentDueDate && dayOf(record.paymentDueDate) <= dayOf(now)) {
      add(booking, venue.createdBy, "VENUE_PAYMENT_DUE", dayOf(record.paymentDueDate), `${venue.venueName}: ${summary.currency} ${(summary.balanceMinor / 100).toFixed(2)} is due for booking ${booking._id}.`);
    }
  }
  return result;
}
let cursor = null;
async function runVenueReminders() {
  const Venue = require("../models/client/eventCenter.schema");
  const venues = await Venue.find(cursor ? { _id: { $gt: cursor } } : {}).sort({ _id: 1 }).limit(100).lean();
  cursor = venues.length === 100 ? venues[venues.length - 1]._id : null;
  const Reminder = require("../models/client/bookingReminder.schema");
  for (const venue of venues) {
    const [platform, manual, records] = await Promise.all([
      require("../models/client/eventCenterBooking.schema").find({ eventCenter: venue._id, status: { $in: ["ACTIVE", "CONFIRMED", "COMPLETED"] } }).lean(),
      require("./manualBookingRead.service").getManualBookings([venue]),
      require("../models/client/bookingOperations.schema").find({ eventCenter: venue._id }).lean(),
    ]);
    const bookings = await require("./bookingAttendance.service").attendanceForBookings([...platform, ...manual]);
    for (const candidate of reminderCandidates(venue, bookings, records)) {
      let claim;
      try {
        claim = await Reminder.findOneAndUpdate({ key: candidate.key, state: { $ne: "SENT" }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date() } }] },
          { $set: { leaseUntil: new Date(Date.now() + 10 * 60000) }, $setOnInsert: { key: candidate.key, state: "PENDING" } }, { upsert: true, new: true });
      } catch (error) { if (error.code === 11000) continue; throw error; }
      const sent = await require("./notification").dispatchNotification({ ...candidate, referenceId: claim._id, referenceType: "Custom", deduplicate: true, channels: ["in_app", "push"] });
      if (sent) await Reminder.updateOne({ _id: claim._id }, { $set: { state: "SENT", sentAt: new Date() } });
    }
  }
}
module.exports = { reminderCandidates, runVenueReminders };
