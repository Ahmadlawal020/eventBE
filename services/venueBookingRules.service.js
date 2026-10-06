const { bookingSessions, dayOf, instant } = require("./bookingAttendance.service");
const error = message => Object.assign(new Error(message), { statusCode: 400, status: 400 });
const addDays = (day, count) => new Date(new Date(`${day}T12:00:00Z`).getTime() + count * 86400000).toISOString().slice(0, 10);
function lastBookableDay(day, months) {
  const date = new Date(`${day}T12:00:00Z`), originalDay = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, end)); return date.toISOString().slice(0, 10);
}
function assertVenueSchedule(venue, dates, unit, { now = new Date(), bookingId, checkTiming = true } = {}) {
  const availability = venue.availability || {};
  const sessions = bookingSessions({ selectedDates: dates, bookingUnit: unit });
  if (!sessions.length) throw error("Select valid booking dates.");
  const today = dayOf(now);
  if (checkTiming) {
    const first = addDays(today, Number(availability.advanceNotice?.days || 0));
    const last = lastBookableDay(today, Number(availability.bookingWindow || 12));
    for (const session of sessions) {
      if (session.date < first) throw error(`This venue requires ${availability.advanceNotice?.days || 0} day(s) advance notice.`);
      if (session.date > last) throw error(`Bookings are available through ${last}.`);
      if (session.date === today && availability.advanceNotice?.sameDayCutoffTime) {
        const [h, m] = availability.advanceNotice.sameDayCutoffTime.split(":").map(Number);
        if (now >= new Date(instant(today, h * 60 + m))) throw error("The same-day booking cutoff has passed.");
      }
      if (unit === "hour" && new Date(session.startsAt) <= now) throw error("Choose an hourly session that has not started.");
    }
  }
  const buffer = Number(availability.preparationTime || 0) * (unit === "hour" ? 3600000 : 86400000);
  for (const entry of [...(availability.unavailableDates || []), ...(availability.unavailableSlots || [])]) {
    if (bookingId && String(entry.bookingId) === String(bookingId)) continue;
    if (entry.holdExpiresAt && new Date(entry.holdExpiresAt) <= now) continue;
    const existing = bookingSessions({ selectedDates: [entry], bookingUnit: entry.startTime ? "hour" : "day" });
    for (const occupied of existing) for (const requested of sessions) {
      if (new Date(requested.startsAt).getTime() < new Date(occupied.endsAt).getTime() + buffer &&
          new Date(requested.endsAt).getTime() > new Date(occupied.startsAt).getTime() - buffer) {
        throw error(buffer ? "These dates conflict with an existing booking or its preparation time." : "These dates are no longer available.");
      }
    }
  }
}
module.exports = { assertVenueSchedule, lastBookableDay };
