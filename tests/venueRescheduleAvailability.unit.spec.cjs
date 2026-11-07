process.env.QR_SIGNING_SECRET = "isolated-availability-test";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { rescheduleAvailability } = require("../services/venueRescheduleAvailability.service");
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const settings = { booking: { maximumBookingWindowMonths: 12 } };
const booking = unit => ({ _id: "my-booking", bookingUnit: unit, duration: 2, selectedDates: [{ date: day(10), ...(unit === "hour" ? { startTime: "10:00", endTime: "12:00" } : {}) }], subtotalPrice: { amount: 200 }, totalPrice: { currency: "NGN" } });
const venue = unit => ({ basePrice: { unit, amount: 100, currency: "NGN", minDuration: 2 },
  availability: { operationalHours: { open: "09:30", close: "17:30" }, minDuration: 2, maxDuration: 10, unavailableDates: [], unavailableSlots: [] } });
test("reschedule calendar removes only own occupancy and never exposes other guest details", () => {
  const v = venue("day");
  v.availability.unavailableDates = [{ date: day(10), bookingId: "my-booking" }, { date: day(11), bookingId: "other-booking", clientName: "Private Guest", clientEmail: "private@example.test" }];
  const data = rescheduleAvailability(booking("day"), v, settings, day(10).slice(0, 7));
  assert.equal(data.days.find(d => d.date === day(10)).available, true);
  if (day(11).slice(0, 7) === data.month) assert.equal(data.days.find(d => d.date === day(11)).available, false);
  assert.equal(data.requiredDuration, 2); assert.equal(data.subtotalMinor, 20000);
  assert.doesNotMatch(JSON.stringify(data), /Private Guest|private@example|other-booking/);
  assert.equal(v.availability.unavailableDates.length, 2);
});
test("hourly slots respect precise opening hours, occupancy and preparation time", () => {
  const v = venue("hour"); v.availability.preparationTime = 1;
  v.availability.unavailableSlots = [{ date: day(10), startTime: "10:00", endTime: "12:00", bookingId: "my-booking" }, { date: day(10), startTime: "13:00", endTime: "14:00", bookingId: "other" }];
  const data = rescheduleAvailability(booking("hour"), v, settings, day(10).slice(0, 7));
  const selected = data.days.find(d => d.date === day(10));
  assert.deepEqual(selected.hours, [10, 11, 15, 16]); assert.equal(selected.minimumHours, 2); assert.equal(selected.rateMinor, 10000);
});
test("platform cutoff and expired holds affect selectable dates without modifying the calendar", () => {
  const v = venue("day"); v.availability.unavailableDates = [{ date: day(10), holdId: "expired", holdExpiresAt: new Date(0) }];
  const data = rescheduleAvailability(booking("day"), v, { booking: { maximumBookingDate: day(10) } }, day(10).slice(0, 7));
  assert.equal(data.days.find(d => d.date === day(10)).available, true);
  assert.equal(data.days.some(d => d.date > day(10) && d.available), false);
  assert.equal(v.availability.unavailableDates.length, 1);
});
test("invalid calendar months, changed units and changed currencies are rejected", () => {
  for (const month of ["2026-13", "not-a-month", [day(10).slice(0, 7)]]) assert.throws(() => rescheduleAvailability(booking("day"), venue("day"), settings, month), { status: 400 });
  assert.throws(() => rescheduleAvailability(booking("hour"), venue("day"), settings, day(10).slice(0, 7)), /booking unit/);
  assert.throws(() => rescheduleAvailability(booking("day"), { ...venue("day"), basePrice: { unit: "day", currency: "USD", amount: 100 } }, settings, day(10).slice(0, 7)), /currency/);
});
