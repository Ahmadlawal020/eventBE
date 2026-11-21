const { createHash } = require("crypto");
const { bookingSessions, dayOf, instant } = require("./bookingAttendance.service");
const { assertVenueSchedule, lastBookableDay } = require("./venueBookingRules.service");
const { fail } = require("./venueAccess.service");
function scheduleWarnings(venue, dates, unit, { bookingId, platformLast, now = new Date() } = {}) {
  const a = venue.availability || {}, sessions = bookingSessions({ selectedDates: dates, bookingUnit: unit });
  const today = dayOf(now), warnings = [];
  const add = (code, date, message) => { if (!warnings.some(w => w.code === code && w.date === date && w.message === message)) warnings.push({ code, date, message }); };
  // Overrides never allow an occupied session or a date/time already in the past.
  assertVenueSchedule({ ...venue, availability: { ...a, preparationTime: 0 } }, dates, unit, { bookingId, now, checkTiming: false });
  if (sessions.some(s => s.date < today || (unit === "hour" && new Date(s.startsAt) <= now))) throw fail(400, "Choose dates or hours that have not already passed.");
  const notice = Number(a.advanceNotice?.days || 0);
  const first = new Date(new Date(today + "T12:00:00Z").getTime() + notice * 86400000).toISOString().slice(0, 10);
  const last = lastBookableDay(today, Number(a.bookingWindow || 12));
  const buffer = Number(a.preparationTime || 0) * (unit === "hour" ? 3600000 : 86400000);
  const minutes = (value, end = false) => end && ["00:00", "24:00"].includes(value) ? 1440 : Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  let duration = 0;
  for (const s of sessions) {
    if (s.date < first) add("ADVANCE_NOTICE", s.date, `${s.date} is inside the venue's ${notice}-day advance-notice period.`);
    if (s.date > last) add("BOOKING_WINDOW", s.date, `${s.date} is after the venue booking window (${last}).`);
    if (platformLast && s.date > platformLast) add("PLATFORM_WINDOW", s.date, `${s.date} is after the customer booking window (${platformLast}).`);
    if (s.date === today && a.advanceNotice?.sameDayCutoffTime) {
      const cutoff = a.advanceNotice.sameDayCutoffTime;
      if (now >= new Date(instant(today, minutes(cutoff)))) add("SAME_DAY_CUTOFF", s.date, `${s.date}: the same-day cutoff of ${cutoff} has passed.`);
    }
    const hours = (+new Date(s.endsAt) - +new Date(s.startsAt)) / 3600000;
    duration += unit === "hour" ? hours : 1;
    if (unit === "hour") {
      const open = a.operationalHours?.open || "00:00", close = a.operationalHours?.close || "24:00";
      if (minutes(s.startTime) < minutes(open) || minutes(s.endTime, true) > minutes(close, true)) add("OPERATING_HOURS", s.date, `${s.date} ${s.startTime}-${s.endTime} is outside operating hours (${open}-${close}).`);
      const minimum = require("./venuePricingRules.service").minimumDuration(venue, s.date);
      if (hours < minimum) add("MINIMUM_HOURS", s.date, `${s.date} has ${hours} hours, below the venue minimum of ${minimum}.`);
    }
    if (buffer > 0) for (const entry of [...(a.unavailableDates || []), ...(a.unavailableSlots || [])]) {
      if (entry.holdId || (bookingId && String(entry.bookingId) === String(bookingId))) continue;
      for (const occupied of bookingSessions({ selectedDates: [entry], bookingUnit: entry.startTime ? "hour" : "day" })) {
        if (+new Date(s.startsAt) < +new Date(occupied.endsAt) + buffer && +new Date(s.endsAt) > +new Date(occupied.startsAt) - buffer)
          add("PREPARATION_TIME", s.date, `${s.date}${unit === "hour" ? ` ${s.startTime}-${s.endTime}` : ""} is within ${a.preparationTime} ${unit}(s) preparation time of the reservation on ${occupied.date}${unit === "hour" ? ` ${occupied.startTime}-${occupied.endTime}` : ""}.`);
      }
    }
  }
  const min = a.minDuration || 1, max = a.maxDuration || 365;
  if (duration < min || duration > max) add("DURATION_LIMIT", sessions[0]?.date, `Selected duration is ${duration} ${unit}(s); the venue normally allows ${min}-${max}.`);
  return warnings;
}
async function getWarnings(venue, dates, unit, options = {}) {
  const settings = await require("./eventCenterSettings.service").getEventCenterSettings();
  const platformLast = settings.booking.maximumBookingDate || lastBookableDay(dayOf(options.now || new Date()), settings.booking.maximumBookingWindowMonths || 12);
  return scheduleWarnings(venue, dates, unit, { ...options, platformLast });
}
function requireAcceptance(previous, changes, warnings, token) {
  if (!warnings.length) return;
  const reviewToken = createHash("sha256").update(JSON.stringify({ id: String(previous._id), updatedAt: previous.updatedAt, changes, warnings })).digest("hex");
  if (token !== reviewToken) throw Object.assign(fail(409, "Review these availability exceptions before saving the booking."), { code: "SCHEDULE_REVIEW_REQUIRED", warnings, reviewToken });
}
module.exports = { scheduleWarnings, getWarnings, requireAcceptance };
