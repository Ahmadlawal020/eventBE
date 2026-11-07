process.env.QR_SIGNING_SECRET = "isolated-cancellation-test-key";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cancellationTerms, refundAmount } = require("../services/venueCancellation.service");
const base = { status: "ACTIVE", paymentStatus: "COMPLETED", bookingUnit: "hour",
  selectedDates: [{ date: "2030-06-10", startTime: "12:00", endTime: "13:00" }],
  cancellationPolicy: { allowGuestCancellation: true, noticeHours: 24, refundDays: 5 },
  subtotalPrice: { amount: 100 }, totalPrice: { amount: 110 } };
test("cutoff uses Lagos time and permits the exact deadline only", () => {
  assert.equal(cancellationTerms(base, new Date("2030-06-09T11:00:00Z")).canGuestCancel, true);
  assert.equal(cancellationTerms(base, new Date("2030-06-09T11:00:00.001Z")).canGuestCancel, false);
});
test("whole booking uses earliest session and day bookings start at local midnight", () => {
  const booking = { ...base, bookingUnit: "day", selectedDates: [{ date: "2030-06-12" }, { date: "2030-06-10" }] };
  assert.equal(cancellationTerms(booking).deadline.toISOString(), "2030-06-08T23:00:00.000Z");
});
test("disabled, legacy, started, checked in and cancelled bookings cannot self-cancel", () => {
  for (const patch of [{ cancellationPolicy: undefined }, { cancellationPolicy: { allowGuestCancellation: false } },
    { status: "CANCELLED" }, { paymentStatus: "PENDING" }, { checkIn: { isCheckedIn: true } },
    { paymentResolutionRequired: true }, { refund: { state: "QUEUED" } }]) {
    assert.equal(cancellationTerms({ ...base, ...patch }, new Date("2030-06-01")).canGuestCancel, false);
  }
  assert.equal(cancellationTerms(base, new Date("2030-06-10T11:00:00Z")).canOrganiserCancel, false);
});
test("refund excludes fees and rejects missing or inconsistent immutable prices", () => {
  assert.equal(refundAmount(base), 10000);
  assert.equal(refundAmount({ ...base, subtotalPrice: { amount: 0 } }), 0);
  for (const amount of [undefined, NaN, -1, 111]) assert.throws(() => refundAmount({ ...base, subtotalPrice: { amount } }), { statusCode: 409 });
});
