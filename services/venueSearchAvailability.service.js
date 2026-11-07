const { fail } = require("./venueAccess.service");
function requestedDates(query) {
  const { bookingDate, bookingEndDate, bookingStartTime, bookingEndTime } = query;
  if (!bookingDate) { if (bookingEndDate || bookingStartTime || bookingEndTime) throw fail(400,"Choose a booking date first."); return null; }
  const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if (!day(bookingDate) || (bookingEndDate && !day(bookingEndDate))) throw fail(400,"Use valid YYYY-MM-DD booking dates.");
  const start = Date.parse(bookingDate), end = Date.parse(bookingEndDate || bookingDate), count = (end - start) / 86400000 + 1;
  if (count < 1 || count > 90) throw fail(400,"Choose between 1 and 90 consecutive dates.");
  const hourly = Boolean(bookingStartTime || bookingEndTime);
  if (hourly && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(bookingStartTime || "") || !/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(bookingEndTime || ""))) throw fail(400,"Enter both start and end times as HH:MM.");
  if (hourly && bookingEndTime !== "00:00" && bookingEndTime <= bookingStartTime) throw fail(400,"End time must follow start time on the same day.");
  return { bookingUnit: hourly ? "hour" : "day", selectedDates: Array.from({length:count},(_,i) => ({ date: new Date(start + i * 86400000).toISOString().slice(0,10), ...(hourly ? { startTime: bookingStartTime, endTime: bookingEndTime } : {}) })) };
}
function available(venue, selection) {
  if (!selection) return true;
  if (venue.basePrice?.unit !== selection.bookingUnit) return false;
  try { require("./checkoutSafety.service").venueQuote(venue,selection); return true; }
  catch(e) { if ([400,409].includes(e.statusCode || e.status)) return false; throw e; }
}
module.exports = { requestedDates, available };
