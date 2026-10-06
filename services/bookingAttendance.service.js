// Venues currently use Nigeria local time; configure explicitly rather than
// depending on the API host's timezone. All attendance timestamps are UTC.
const TIME_ZONE = process.env.BOOKING_TIME_ZONE || "Africa/Lagos";
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const parts = value => Object.fromEntries(dateFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
function dayOf(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const p = parts(value);
  return `${p.year}-${p.month}-${p.day}`;
}
function instant(day, minute) {
  const wall = new Date(`${day}T00:00:00Z`).getTime() + minute * 60000;
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(utc);
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    utc += wall - local;
  }
  return new Date(utc).toISOString();
}
function minutes(time, end = false) {
  if (end && time === "00:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "") && !(end && time === "24:00")) return NaN;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
const clock = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
function bookingSessions(booking) {
  const days = new Map();
  for (const item of booking.selectedDates || booking.dates || []) {
    if (!item.date || Number.isNaN(new Date(item.date).getTime())) continue;
    const day = dayOf(item.date);
    let start = 0, end = 1440;
    if (booking.bookingUnit === "hour" || item.startTime) {
      if (item.startTime && item.endTime) {
        start = minutes(item.startTime); end = minutes(item.endTime, true);
      } else {
        const p = parts(item.date);
        start = +p.hour * 60 + +p.minute; end = start + 60;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > 1440) continue;
    }
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({ start, end });
  }
  const sessions = [];
  for (const [day, ranges] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const merged = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else merged.push({ ...range });
    }
    for (const range of merged) sessions.push({
      sessionId: `${day}:${range.start}-${range.end}`, date: day,
      startTime: clock(range.start), endTime: clock(range.end),
      startsAt: instant(day, range.start), endsAt: instant(day, range.end),
      allDay: booking.bookingUnit !== "hour",
    });
  }
  return sessions;
}
function attendanceFor(booking, records = [], now = new Date()) {
  const eligible = ["ACTIVE", "CONFIRMED", "COMPLETED"].includes(booking.status);
  const legacy = booking.checkIn?.isCheckedIn && booking.checkIn.checkedInAt ? booking.checkIn : null;
  let legacyMatched = false;
  const sessions = bookingSessions(booking).map(session => {
    const record = records.find(row => row.sessionId === session.sessionId);
    const phase = now < new Date(session.startsAt) ? "UPCOMING" : now >= new Date(session.endsAt) ? "ENDED" : "ONGOING";
    const legacyApplies = legacy && new Date(legacy.checkedInAt) >= new Date(session.startsAt) && new Date(legacy.checkedInAt) < new Date(session.endsAt);
    if (legacyApplies) legacyMatched = true;
    const status = record?.status || (legacyApplies ? "ATTENDED" : phase === "ENDED" ? "UNCONFIRMED" : phase === "ONGOING" ? "AWAITING_CHECK_IN" : "UPCOMING");
    return { ...session, phase, status, revision: record?.revision || 0,
      audit: record?.audit || (legacyApplies ? [{ status: "ATTENDED", actor: legacy.checkedInBy, at: legacy.checkedInAt, method: legacy.method || "MANUAL", reason: "Previous check-in matched to this session" }] : []),
      canMarkAttended: eligible && phase !== "UPCOMING" && status !== "ATTENDED",
      canMarkNoShow: eligible && phase === "ENDED" && status !== "NO_SHOW",
    };
  });
  const summary = { attended: 0, noShow: 0, unconfirmed: 0, awaiting: 0, upcoming: 0, total: sessions.length };
  const keys = { ATTENDED: "attended", NO_SHOW: "noShow", UNCONFIRMED: "unconfirmed", AWAITING_CHECK_IN: "awaiting", UPCOMING: "upcoming" };
  sessions.forEach(session => summary[keys[session.status]]++);
  return { sessions, summary, legacyUnassigned: !!legacy && !legacyMatched, timeZone: TIME_ZONE, eligible };
}
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
async function loadBooking(eventCenterId, bookingId) {
  const mongoose = require("mongoose");
  if (mongoose.Types.ObjectId.isValid(bookingId)) {
    const booking = await require("../models/client/eventCenterBooking.schema").findOne({ _id: bookingId, eventCenter: eventCenterId }).lean();
    if (booking) return booking;
  }
  const venue = await require("../models/client/eventCenter.schema").findById(eventCenterId).lean();
  if (!venue) fail(404, "Venue not found.");
  const booking = (await require("./manualBookingRead.service").getManualBookings([venue])).find(item => item.bookingId === bookingId);
  if (!booking) fail(404, "Booking not found for this venue.");
  return booking;
}
async function saveAttendance({ eventCenterId, bookingId, sessionId, status, expectedRevision, reason, proofVerified, actor, method = "MANUAL", booking, now = new Date() }) {
  const Attendance = require("../models/client/bookingAttendance.schema");
  if (!["ATTENDED", "NO_SHOW"].includes(status)) fail(400, "Choose attended or no-show.");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) fail(400, "Refresh attendance before saving.");
  booking ||= await loadBooking(eventCenterId, bookingId);
  const records = await Attendance.find({ eventCenter: eventCenterId, bookingId }).lean();
  const attendance = attendanceFor(booking, records, now);
  if (!attendance.eligible) fail(400, "Attendance cannot be changed for this booking status.");
  const session = attendance.sessions.find(item => item.sessionId === sessionId);
  if (!session) fail(409, "The booking dates changed. Refresh and select a current session.");
  if (session.revision !== expectedRevision) fail(409, "Attendance was changed by someone else. Refresh and try again.");
  if (session.status === status) fail(409, "This session already has that attendance status.");
  if (status === "ATTENDED" ? !session.canMarkAttended : !session.canMarkNoShow) fail(400, "This attendance action is not available yet.");
  const note = typeof reason === "string" ? reason.trim() : "";
  if (note.length > 500) fail(400, "Keep the reason under 500 characters.");
  if ((session.phase === "ENDED" || ["ATTENDED", "NO_SHOW"].includes(session.status)) && !note) fail(400, "A reason is required for attendance decisions and corrections.");
  if (status === "ATTENDED" && proofVerified !== true) fail(400, "Confirm the guest's proof of booking before marking attendance.");
  const audit = { status, previousStatus: session.status, actor, at: now, reason: note, method, proofVerified: proofVerified === true };
  const id = `${eventCenterId}:${bookingId}:${sessionId}`;
  try {
    if (expectedRevision === 0) {
      await Attendance.create({ _id: id, eventCenter: eventCenterId, bookingId, sessionId, status, revision: 1, audit: [audit] });
    } else {
      const updated = await Attendance.findOneAndUpdate({ _id: id, revision: expectedRevision }, {
        $set: { status }, $inc: { revision: 1 }, $push: { audit },
      }, { new: true, runValidators: true });
      if (!updated) fail(409, "Attendance was changed by someone else. Refresh and try again.");
    }
  } catch (error) {
    if (error.code === 11000) fail(409, "Attendance was changed by someone else. Refresh and try again.");
    throw error;
  }
  return { sessionId, status, revision: expectedRevision + 1, recordedAt: now };
}
async function checkInCurrentSession({ booking, eventCenterId, actor, method = "MANUAL", proofVerified = true }) {
  const now = new Date();
  const session = bookingSessions(booking).find(item => new Date(item.startsAt) <= now && now < new Date(item.endsAt));
  if (!session) fail(400, "No session is currently ongoing. Use booking attendance to record a past visit.");
  return saveAttendance({ eventCenterId, bookingId: String(booking._id), sessionId: session.sessionId, status: "ATTENDED", expectedRevision: 0, actor, method, proofVerified, booking, now });
}
async function currentSessionCheckIn(booking, eventCenterId) {
  const records = await require("../models/client/bookingAttendance.schema").find({ eventCenter: eventCenterId, bookingId: String(booking._id) }).lean();
  const session = attendanceFor(booking, records).sessions.find(item => item.phase === "ONGOING");
  const last = session?.audit[session.audit.length - 1];
  return { isCheckedIn: session?.status === "ATTENDED", checkedInAt: last?.at };
}
async function attendanceForBookings(bookings) {
  const venues = [...new Set(bookings.map(b => String(b.eventCenter?._id || b.eventCenter)))];
  const records = await require("../models/client/bookingAttendance.schema").find({ eventCenter: { $in: venues } }).lean();
  return bookings.map(booking => ({ ...booking, attendance: attendanceFor(booking, records.filter(row =>
    row.bookingId === String(booking._id) && String(row.eventCenter) === String(booking.eventCenter?._id || booking.eventCenter))) }));
}
async function withCurrentCheckIns(bookings) {
  const enriched = await attendanceForBookings(bookings.map(b => b.toObject ? b.toObject() : b));
  return enriched.map(booking => {
    const current = booking.attendance.sessions.find(session => session.phase === "ONGOING");
    const last = current?.audit[current.audit.length - 1];
    return { ...booking, checkIn: { isCheckedIn: current?.status === "ATTENDED", checkedInAt: last?.at, checkedInBy: last?.actor, method: last?.method } };
  });
}
module.exports = { dayOf, instant, TIME_ZONE, withCurrentCheckIns, attendanceForBookings, currentSessionCheckIn, bookingSessions, attendanceFor, saveAttendance, loadBooking, checkInCurrentSession };
