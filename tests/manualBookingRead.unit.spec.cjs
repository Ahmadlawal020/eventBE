const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { buildManualBookings, manualCollectedAmount } = require("../services/manualBookingRead.service");
const now = new Date("2030-01-01T12:00:00Z");
const entry = (date, extra = {}) => ({ type: "MANUAL", bookingId: "manual-1", date, clientName: "Ada", totalPrice: 1000, paymentStatus: "paid", ...extra });
const venue = entries => ({ _id: "venue-1", createdBy: "owner", venueName: "Hall", basePrice: { unit: "day", currency: "NGN" }, availability: { unavailableDates: entries } });
const read = (v, history = [], checks = []) => buildManualBookings([v], history, checks, now);

test("multiple manual dates are one booking even without a history entry", () => {
  const [booking] = read(venue([entry("2030-02-01"), entry("2030-02-02")]));
  assert.equal(booking.bookingId, "manual-1");
  assert.equal(booking.duration, 2);
  assert.equal(booking.totalPrice.amount, 1000);
  assert.equal(booking.status, "ACTIVE");
  assert.equal(booking.guestDetails.fullName, "Ada");
});
test("current calendar dates override stale creation history", () => {
  const [booking] = read(venue([entry("2030-03-01")]), [{ eventCenter: "venue-1", bookingId: "manual-1", bookingType: "MANUAL", action: "CREATED", dates: [{ date: "2030-02-01" }], createdAt: "2029-12-01" }]);
  assert.equal(booking.dates[0].date, "2030-03-01");
});
test("hour slots are grouped with their actual duration", () => {
  const v = venue([]);
  v.basePrice.unit = "hour";
  v.availability.unavailableSlots = [entry("2030-02-01", { startTime: "10:00", endTime: "12:30" }), entry("2030-02-02", { startTime: "23:00", endTime: "24:00" })];
  const [booking] = read(v);
  assert.equal(booking.duration, 3.5);
  assert.equal(booking.dates.length, 2);
});
test("blocked dates are excluded and distinct bookings stay separate", () => {
  const bookings = read(venue([entry("2030-02-01"), entry("2030-02-02", { bookingId: "manual-2" }), entry("2030-02-03", { type: "BLOCKED" })]));
  assert.equal(bookings.length, 2);
});
test("removed historical bookings remain cancelled", () => {
  const [booking] = read(venue([]), [{ eventCenter: "venue-1", bookingId: "manual-1", bookingType: "MANUAL", action: "CREATED", dates: [{ date: "2030-02-01" }], totalPrice: { amount: 1000 } }]);
  assert.equal(booking.status, "CANCELLED");
  assert.equal(manualCollectedAmount(booking), 0);
});
test("persisted check-in is scoped to the venue", () => {
  const v = venue([entry("2030-02-01")]);
  const checks = [{ eventCenter: "venue-2", bookingId: "manual-1", checkedInAt: "2030-01-01" }];
  assert.equal(read(v, [], checks)[0].checkIn.isCheckedIn, false);
  checks.push({ eventCenter: "venue-1", bookingId: "manual-1", checkedInAt: "2030-01-01", checkedInBy: "owner" });
  assert.equal(read(v, [], checks)[0].checkIn.checkedInBy, "owner");
});
test("partial payment contributes only the deposit to revenue", () => {
  const [booking] = read(venue([entry("2030-02-01", { paymentStatus: "partially_paid", depositAmount: 250 })]));
  assert.equal(booking.paymentStatus, "PARTIALLY_PAID");
  assert.equal(manualCollectedAmount(booking), 250);
});
test("past manual bookings are completed", () => {
  assert.equal(read(venue([entry("2029-12-01")]))[0].status, "COMPLETED");
});

function controllerFixture(owner = true) {
  const v = venue([entry("2030-02-01"), entry("2030-02-02")]);
  const chain = value => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, lean: async () => value });
  const mocks = {
    "../../services/bookingAttendance.service": { attendanceForBookings: async bookings => bookings.map(b => ({ ...b, attendance: { summary: { attended: b.checkIn?.isCheckedIn ? 1 : 0 } } })) },
    "../../services/manualBookingRead.service": { getManualBookings: async venues => buildManualBookings(venues, [], [], now), manualCollectedAmount },
    "../../models/client/eventCenter.schema": { findOne: () => chain(v) },
    "../../models/client/eventCenterBooking.schema": { find: () => chain([{ _id: "client-1", status: "ACTIVE", paymentStatus: "COMPLETED", totalPrice: { amount: 500 }, checkIn: { isCheckedIn: true } }]) },
    "../../models/client/coOrganiserInvitation.schema": { findOne: () => chain({ permissions: ["VIEW_CALENDAR"] }) },
    "../../models/client/staffInvitation.schema": { findOne: () => chain(null) },
    mongoose: {},
  };
  const sandbox = { require: id => { assert.ok(id in mocks, id); return mocks[id]; }, module: { exports: {} }, console };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/client/bookingDashboard.controller"), "utf8"), sandbox);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  return { run: async () => { await sandbox.module.exports.getSingleVenueBookingStats({ params: { venueId: "venue-1" }, user: { id: owner ? "owner" : "viewer" } }, res); return res; } };
}
test("venue endpoint returns client and grouped manual bookings with combined totals", async () => {
  const res = await controllerFixture().run();
  assert.equal(res.code, 200);
  assert.equal(res.body.data.bookings.length, 2);
  assert.equal(res.body.data.stats.total, 2);
  assert.equal(res.body.data.stats.revenue, 1500);
  assert.equal(res.body.data.stats.checkedIn, 1);
  assert.equal(res.body.data.bookings.find(b => b.bookingType === "MANUAL").selectedDates.length, 2);
});
test("venue endpoint hides manual amounts and deposits without finance permission", async () => {
  const res = await controllerFixture(false).run();
  assert.equal(res.code, 200);
  assert.equal(res.body.data.stats.revenue, null);
  const manual = res.body.data.bookings.find(b => b.bookingType === "MANUAL");
  assert.equal(manual.totalPrice.amount, null);
  assert.equal(manual.depositAmount, null);
  assert.equal(res.body.data.venue.availability, undefined);
});

test("legacy hourly entries preserve venue local time independently of the API host", () => {
  const v = venue([entry("2030-02-01T23:00:00Z")]);
  v.basePrice.unit = "hour";
  const [booking] = read(v);
  assert.equal(booking.dates[0].date, "2030-02-02");
  assert.equal(booking.dates[0].startTime, "00:00");
  assert.equal(booking.dates[0].endTime, "01:00");
});
