process.env.NODE_ENV = "test";
process.env.QR_SIGNING_SECRET = "isolated-venue-audit-key";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { venueEditablePayload } = require("../services/venueEditableFields.service");
const { guestVenueBooking } = require("../services/guestVenueBooking.service");
const { venueQuote } = require("../services/checkoutSafety.service");
const { reviewDeadline, assertReviewOpen } = require("../services/venueReviewPolicy.service");
const { venueMoney, manualMoney } = require("../services/venueMoney.service");
const futureDay = weekday => {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 7 + (weekday - date.getUTCDay() + 7) % 7);
  return date.toISOString().slice(0, 10);
};
test("venue editors cannot mutate ownership, internal state or dotted/operator fields", () => {
  for (const key of ["createdBy", "coOrganisers", "staff", "performance", "archivedAt", "bookingVersion", "moderation", "availability.unavailableDates", "$set"]) {
    assert.throws(() => venueEditablePayload({ [key]: "tamper" }), { status: 400 });
  }
  assert.throws(() => venueEditablePayload({ availability: { "$unset": {} } }), { status: 400 });
  assert.deepEqual(venueEditablePayload({ venueName: "Hall", availability: { minDuration: 2 } }), { venueName: "Hall", availability: { minDuration: 2 } });
});
test("guest booking serialization strips other guests contacts and venue operations", () => {
  const booking = { _id: "one", guestDetails: { fullName: "Me" }, eventCenter: {
    venueName: "Hall", staff: ["secret"], performance: { revenue: 999 },
    availability: { unavailableDates: [{ date: "2030-01-01", type: "MANUAL", bookingId: "other", clientName: "Other", clientEmail: "private@example.test", clientPhone: "123" }] },
  } };
  const result = guestVenueBooking(booking);
  assert.equal(JSON.stringify(result).includes("private@example.test"), false);
  assert.equal(result.eventCenter.staff, undefined);
  assert.equal(result.eventCenter.performance, undefined);
  assert.equal(result.guestDetails.fullName, "Me");
  assert.equal(booking.eventCenter.availability.unavailableDates[0].clientEmail, "private@example.test");
});
test("weekend quote uses Saturday and Sunday; weekday and weekend minimum hours are enforced", () => {
  const venue = { basePrice: { amount: 100, unit: "hour", currency: "NGN", minDuration: 3 }, weekendPrice: { amount: 150, minDuration: 5 },
    availability: { minDuration: 1, maxDuration: 24, operationalHours: { open: "06:00", close: "24:00" } } };
  const quote = (weekday, endTime) => venueQuote(venue, { bookingUnit: "hour", selectedDates: [{ date: futureDay(weekday), startTime: "10:00", endTime }] });
  assert.equal(quote(5, "13:00").subtotalAmount, 300);
  assert.equal(quote(6, "15:00").subtotalAmount, 750);
  assert.equal(quote(0, "15:00").subtotalAmount, 750);
  assert.throws(() => quote(5, "12:00"), /at least 3 hours/);
  assert.throws(() => quote(6, "14:00"), /at least 5 hours/);
  const twoDays = { ...venue, availability: { ...venue.availability, minDuration: 6 } };
  assert.equal(venueQuote(twoDays, { bookingUnit: "hour", selectedDates: [
    { date: futureDay(5), startTime: "10:00", endTime: "13:00" },
    { date: futureDay(6), startTime: "10:00", endTime: "15:00" },
  ] }).duration, 8);
  assert.throws(() => venueQuote({ ...venue, basePrice: { ...venue.basePrice, unit: "event" } }, { bookingUnit: "event", selectedDates: [{ date: futureDay(5) }] }), /unit/);
});
test("approval deadlines are bounded by the booked start, including legacy requests", () => {
  const booking = { bookingUnit: "hour", selectedDates: [{ date: "2030-06-10", startTime: "12:00", endTime: "13:00" }] };
  const now = new Date("2030-06-10T09:00:00Z");
  assert.equal(reviewDeadline(booking, now).toISOString(), "2030-06-10T11:00:00.000Z");
  assert.throws(() => assertReviewOpen({ ...booking, reviewDeadline: new Date("2030-06-11") }, new Date("2030-06-10T11:00:00Z")), { statusCode: 409 });
});
test("money totals deduct sent refunds once and preserve confirmation and currency separately", () => {
  const booking = { _id: "one", totalPrice: { amount: 110, currency: "NGN" }, paymentStatus: "COMPLETED", platformFeeAmount: 10 };
  const refund = { amountMinor: 10000, currency: "NGN", markedPaidAt: new Date(), status: "MARKED_PAID" };
  const [sent] = venueMoney([booking], [refund]);
  assert.equal(sent.grossCollections, 110); assert.equal(sent.fees, 10); assert.equal(sent.refundsSent, 100);
  assert.equal(sent.netReceipts, 0); assert.equal(sent.refundsConfirmed, 0);
  const [confirmed] = venueMoney([booking], [{ ...refund, status: "CONFIRMED_BY_BUYER" }]);
  assert.equal(confirmed.netReceipts, 0); assert.equal(confirmed.refundsConfirmed, 100);
  const [pending] = venueMoney([booking], [{ ...refund, markedPaidAt: null, status: "DUE_FROM_ORGANISER" }]);
  assert.equal(pending.refundLiability, 100); assert.equal(pending.netReceipts, 100);
  assert.equal(venueMoney([booking, { ...booking, totalPrice: { amount: 50, currency: "USD" } }]).length, 2);
});
test("full provider refunds and manual partial refunds reconcile without mixing security deposits", () => {
  const [provider] = venueMoney([{ totalPrice: { amount: 110, currency: "NGN" }, paymentStatus: "REFUNDED", platformFeeAmount: 10, refund: { state: "PROCESSED", amountMinor: 11000 } }]);
  assert.equal(provider.netReceipts, 0); assert.equal(provider.refundsSent, 110);
  const booking = { status: "CANCELLED", totalPrice: { amount: 500, currency: "NGN" } };
  const money = manualMoney(booking, { openingPaidMinor: 20000, payments: [
    { kind: "PAYMENT", amountMinor: 5000 }, { kind: "REFUND", amountMinor: 10000 }, { kind: "SECURITY_DEPOSIT", amountMinor: 30000 },
  ] });
  assert.deepEqual(money, { grossCollectedMinor: 25000, refundedMinor: 10000, confirmedRefundMinor: 0, approvedRefundMinor: 0, netCollectedMinor: 15000 });
  const [manual] = venueMoney([], [], [{ ...booking, manualFinance: money }]);
  assert.equal(manual.netReceipts, 150); assert.equal(manual.refundLiability, 150);
});
