process.env.NODE_ENV = "test";
process.env.QR_SIGNING_SECRET = "remediation-tests-only";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { openingMoney, validateManualSchedule } = require("../services/venueCalendarMutation.service");
const { buildManualBookings } = require("../services/manualBookingRead.service");
test("manual opening collections reject inconsistent, negative and excessive amounts", () => {
  for (const values of [{ depositAmount: -1 }, { depositAmount: 101 }, { depositAmount: 1, paymentStatus: "pending" }, { depositAmount: 0, paymentStatus: "partially_paid" }]) {
    assert.throws(() => openingMoney({ totalPrice: 100, paymentStatus: "pending", ...values }), { status: 400 });
  }
  assert.equal(openingMoney({ totalPrice: 100, depositAmount: 40, paymentStatus: "partially_paid" }), 4000);
});
test("manual scheduling uses the same preparation buffer and operating limits", () => {
  const venue = { basePrice: { unit: "day" }, availability: { preparationTime: 2, unavailableDates: [{ date: "2030-01-10", type: "BOOKED" }] } };
  assert.throws(() => validateManualSchedule(venue, [{ date: "2030-01-11" }], "day", "manual-new", new Date("2030-01-01")), /preparation/);
  assert.equal(validateManualSchedule(venue, [{ date: "2030-01-13" }], "day", "manual-new", new Date("2030-01-01")).length, 1);
});
test("manual snapshots preserve original currency and unit after listing edits", () => {
  const result = buildManualBookings([{ _id: "v", basePrice: { unit: "day", currency: "USD" }, availability: { unavailableSlots: [{ type: "MANUAL", bookingId: "manual-one", bookingUnit: "hour", currency: "NGN", date: "2030-01-01", startTime: "23:00", endTime: "00:00", totalPrice: 100 }] } }]);
  assert.equal(result[0].totalPrice.currency, "NGN"); assert.equal(result[0].bookingUnit, "hour"); assert.equal(result[0].duration, 1);
});

test("availability search validates ranges and shares checkout conflict rules", () => {
  const { requestedDates, available } = require("../services/venueSearchAvailability.service");
  for (const q of [{bookingDate:"2030-02-30"}, {bookingDate:"2030-01-03",bookingEndDate:"2030-01-01"}, {bookingStartTime:"10:00"}, {bookingDate:"2030-01-03",bookingStartTime:"13:00",bookingEndTime:"12:00"}]) assert.throws(()=>requestedDates(q),{status:400});
  const date = new Date(Date.now()+20*86400000).toISOString().slice(0,10);
  const selection=requestedDates({bookingDate:date});
  const venue={basePrice:{unit:"day",amount:100,currency:"NGN"},availability:{unavailableDates:[{date,type:"MANUAL",bookingId:"manual-other"}]}};
  assert.equal(available(venue,selection),false);
  venue.availability.unavailableDates=[]; assert.equal(available(venue,selection),true);
});
