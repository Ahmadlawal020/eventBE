const { dayOf } = require("./bookingAttendance.service");
const { lastBookableDay } = require("./venueBookingRules.service");
const { venueQuote } = require("./checkoutSafety.service");
const { minimumDuration } = require("./venuePricingRules.service");
const { fail } = require("./venueAccess.service");
const clock = hour => String(hour).padStart(2, "0") + ":00";
function rescheduleAvailability(booking, venue, settings, month, now = new Date()) {
  const today = dayOf(now);
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) throw fail(400, "Choose a calendar month in YYYY-MM format.");
  const platformEnd = settings.booking.maximumBookingDate || lastBookableDay(today, settings.booking.maximumBookingWindowMonths || 12);
  const venueEnd = lastBookableDay(today, venue.availability?.bookingWindow || 12);
  const maxDate = platformEnd < venueEnd ? platformEnd : venueEnd;
  if (month < today.slice(0, 7) || month > maxDate.slice(0, 7)) throw fail(400, "Choose a month within the booking window.");
  if (venue.basePrice?.unit !== booking.bookingUnit) throw fail(409, "The venue's booking unit has changed. Contact the organiser about this booking.");
  if (String(venue.basePrice?.currency || "").toUpperCase() !== booking.totalPrice.currency) throw fail(409, "The venue currency has changed. Contact the organiser about this booking.");
  if (!Number.isInteger(booking.duration) || booking.duration <= 0 || !Number.isFinite(booking.subtotalPrice?.amount)) throw fail(409, "This booking needs a duration or price review by support.");
  const candidate = { ...venue, availability: { ...venue.availability, minDuration: 1, maxDuration: 1096 * 24 },
    basePrice: { ...venue.basePrice, minDuration: 1 }, weekendPrice: venue.weekendPrice ? { ...venue.weekendPrice, minDuration: 1 } : undefined };
  // Own reservations may be retained or moved. Other guests' occupancy is never exposed.
  for (const field of ["unavailableDates", "unavailableSlots"]) candidate.availability[field] =
    (venue.availability?.[field] || []).filter(entry => String(entry.bookingId) !== String(booking._id));
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= count; d++) {
    const date = month + "-" + String(d).padStart(2, "0");
    const hours = []; let rateMinor = null, available = false;
    if (date >= today && date <= maxDate) for (const hour of booking.bookingUnit === "hour" ? Array.from({ length: 24 }, (_, i) => i) : [null]) {
      try {
        const quote = venueQuote(candidate, { bookingUnit: booking.bookingUnit, selectedDates: [{ date, ...(hour === null ? {} : { startTime: clock(hour), endTime: clock(hour + 1) }) }] });
        available = true; if (rateMinor === null) rateMinor = Math.round(quote.subtotalAmount * 100);
        if (hour !== null) hours.push(hour);
      } catch (error) { if (![400, 409].includes(error.statusCode || error.status)) throw error; }
    }
    days.push({ date, available, hours, rateMinor, minimumHours: booking.bookingUnit === "hour" ? minimumDuration(venue, date) : 1 });
  }
  return { month, minDate: today, maxDate, timeZone: "Africa/Lagos", bookingUnit: booking.bookingUnit,
    requiredDuration: booking.duration, subtotalMinor: Math.round(booking.subtotalPrice.amount * 100), currency: booking.totalPrice.currency,
    originalDates: booking.selectedDates.map(row => ({ date: dayOf(row.date), ...(booking.bookingUnit === "hour" ? { startTime: row.startTime, endTime: row.endTime === "00:00" ? "24:00" : row.endTime } : {}) })), days };
}
module.exports = { rescheduleAvailability };
