const test = require("node:test");
const assert = require("node:assert/strict");
const { paymentSummary, applyOperation, confirmationText } = require("../services/bookingOperations.service");
const { assertVenueSchedule, lastBookableDay } = require("../services/venueBookingRules.service");
const { attendanceFor } = require("../services/bookingAttendance.service");
const { venueFinanceSummary } = require("../services/venueFinanceSummary.service");
const { reminderCandidates } = require("../services/venueReminders.service");
const booking = { _id: "manual-1", status: "ACTIVE", bookingType: "MANUAL", bookingUnit: "day", guestName: "Ada", paymentStatus: "PARTIALLY_PAID", depositAmount: 200, totalPrice: { amount: 1000, currency: "NGN" }, selectedDates: [{ date: "2030-01-02" }] };
const record = { revision: 0, openingPaidMinor: 20000, payments: [], audit: [], handovers: [] };
const now = new Date("2030-01-02T12:00:00Z");
const payment = { action: "PAYMENT", id: "payment-one", kind: "PAYMENT", amount: 300, method: "CASH", reference: "receipt-1" };
test("payment ledger preserves opening deposit and computes the remaining balance", () => {
  const updated = applyOperation(booking, record, payment, "owner", now);
  assert.equal(paymentSummary(booking, updated).paidMinor, 50000);
  assert.equal(paymentSummary(booking, updated).balanceMinor, 50000);
  assert.equal(record.payments.length, 0); assert.equal(updated.payments[0].actor, "owner");
  assert.equal(updated.revision, 1);
});
test("payment idempotency key cannot add the same collection twice", () => {
  const updated = applyOperation(booking, record, payment, "owner", now);
  const again = applyOperation(booking, updated, payment, "owner", now);
  assert.equal(again.payments.length, 1); assert.equal(again.revision, 1);
});
test("overpayments, negative amounts and platform cash replacements are rejected", () => {
  for (const amount of [-1, 0, 801, Infinity]) assert.throws(() => applyOperation(booking, record, { ...payment, amount }, "owner", now));
  assert.throws(() => applyOperation({ ...booking, bookingType: "PLATFORM" }, record, payment, "owner", now));
});
test("cash refunds require a reason and cannot exceed money received", () => {
  assert.throws(() => applyOperation(booking, record, { ...payment, kind: "REFUND", amount: 100 }, "owner", now));
  assert.throws(() => applyOperation(booking, record, { ...payment, kind: "REFUND", amount: 201, reason: "Cancelled" }, "owner", now));
  const updated = applyOperation(booking, record, { ...payment, kind: "REFUND", amount: 100, reason: "Agreed reduction" }, "owner", now);
  assert.equal(paymentSummary(booking, updated).paidMinor, 10000);
});
test("security deposits remain separate from booking revenue", () => {
  let updated = applyOperation(booking, record, { ...payment, kind: "SECURITY_DEPOSIT" }, "owner", now);
  assert.equal(paymentSummary(booking, updated).paidMinor, 20000);
  assert.equal(paymentSummary(booking, updated).securityMinor, 30000);
  updated = applyOperation(booking, updated, { ...payment, id: "return-one", kind: "SECURITY_RETURN", reason: "Inspection complete" }, "owner", now);
  assert.equal(paymentSummary(booking, updated).securityMinor, 0);
});
test("confirmation shares dates and money but never private notes", () => {
  const text = confirmationText(booking, { ...record, privateNotes: "PRIVATE DATA", eventPurpose: "Wedding" }, "Main Hall");
  assert.match(text, /Main Hall/); assert.match(text, /Balance due: NGN 800.00/); assert.match(text, /Wedding/); assert.doesNotMatch(text, /PRIVATE DATA/);
});
test("handover records checkout once and preserves subsequent inspection updates", () => {
  const sessionId = attendanceFor(booking, [], now).sessions[0].sessionId;
  let updated = applyOperation(booking, record, { action: "HANDOVER", sessionId, overtimeMinutes: 30, cleaned: false, reason: "Keys returned" }, "owner", now);
  updated = applyOperation(booking, updated, { action: "HANDOVER", sessionId, overtimeMinutes: 30, cleaned: true, reason: "Cleaned" }, "cleaner", new Date("2030-01-03"));
  assert.equal(updated.handovers.length, 1); assert.equal(new Date(updated.handovers[0].checkedOutAt).getTime(), now.getTime());
  assert.equal(updated.audit.length, 2); assert.equal(updated.handovers[0].cleaned, true);
});
test("future or unknown sessions cannot be checked out", () => {
  assert.throws(() => applyOperation(booking, record, { action: "HANDOVER", sessionId: "unknown", overtimeMinutes: 0, reason: "Done" }, "owner", now));
});
const venue = (availability = {}) => ({ _id: "venue", venueName: "Hall", createdBy: "owner", availability });
const slots = [{ date: "2030-01-03", startTime: "10:00", endTime: "11:00" }];
test("advance notice and same-day cutoff are enforced in venue time", () => {
  assert.throws(() => assertVenueSchedule(venue({ advanceNotice: { days: 2 } }), slots, "hour", { now }), /advance notice/);
  assert.throws(() => assertVenueSchedule(venue({ advanceNotice: { sameDayCutoffTime: "12:00" } }), [{ date: "2030-01-02" }], "day", { now }), /cutoff/);
});
test("booking horizon clamps month-end dates and rejects dates beyond venue window", () => {
  assert.equal(lastBookableDay("2030-01-31", 1), "2030-02-28");
  assert.throws(() => assertVenueSchedule(venue({ bookingWindow: 3 }), [{ date: "2030-05-01" }], "day", { now }), /through/);
});
test("hourly preparation gaps are protected but exact buffer boundaries are available", () => {
  const v = venue({ preparationTime: 1, unavailableSlots: [{ date: "2030-01-03", startTime: "08:00", endTime: "10:00", type: "MANUAL", bookingId: "other" }] });
  assert.throws(() => assertVenueSchedule(v, slots, "hour", { now }), /preparation/);
  assert.doesNotThrow(() => assertVenueSchedule(v, [{ ...slots[0], startTime: "11:00", endTime: "12:00" }], "hour", { now }));
});
test("day preparation gaps span the dates before and after a booking", () => {
  const v = venue({ preparationTime: 1, unavailableDates: [{ date: "2030-01-04", type: "BOOKED", bookingId: "other" }] });
  assert.throws(() => assertVenueSchedule(v, [{ date: "2030-01-03" }], "day", { now }), /preparation/);
  assert.throws(() => assertVenueSchedule(v, [{ date: "2030-01-05" }], "day", { now }), /preparation/);
});
test("expired holds do not block new reservations", () => {
  const v = venue({ unavailableDates: [{ date: "2030-01-03", holdExpiresAt: "2030-01-01", type: "BLOCKED" }] });
  assert.doesNotThrow(() => assertVenueSchedule(v, slots, "hour", { now }));
});
test("pending payouts are not unsettled customer payments and currencies are separate", () => {
  const rows = venueFinanceSummary([{ currency: "NGN", status: "SUCCESS", amountMinor: 10000 }, { currency: "NGN", status: "PENDING", amountMinor: 5000 }, { currency: "USD", status: "FAILED", amountMinor: 2000 }], [booking]);
  const ngn = rows.find(r => r.currency === "NGN"), usd = rows.find(r => r.currency === "USD");
  assert.equal(ngn.confirmedPayouts, 100); assert.equal(ngn.pendingPayouts, 50); assert.equal(ngn.directCollections, 200); assert.equal(ngn.outstandingDirect, 800); assert.equal(usd.payoutAttention, 20);
});
test("reminders have distinct session and recipient keys", () => {
  const b = { ...booking, buyer: "client", selectedDates: [{ date: "2030-01-03" }] };
  b.attendance = attendanceFor(b, [], now);
  const candidates = reminderCandidates(venue(), [b], [], now);
  assert.equal(candidates.length, 2); assert.notEqual(candidates[0].key, candidates[1].key);
  assert.equal(candidates[1].data.screen, "TicketDetails");
});
test("manual bookings remind the organiser, without inventing an account for a phone number", () => {
  const b = { ...booking, selectedDates: [{ date: "2030-01-03" }] }; b.attendance = attendanceFor(b, [], now);
  const candidates = reminderCandidates(venue(), [b], [], now);
  assert.equal(candidates.length, 1); assert.equal(candidates[0].recipient, "owner");
});
test("unconfirmed attendance and unpaid due dates produce follow-up reminders", () => {
  const b = { ...booking, selectedDates: [{ date: "2030-01-01" }] }; b.attendance = attendanceFor(b, [], now);
  const candidates = reminderCandidates(venue(), [b], [{ ...record, bookingId: b._id, paymentDueDate: "2030-01-02" }], now);
  assert.ok(candidates.some(c => c.type === "VENUE_ATTENDANCE_FOLLOWUP"));
  assert.ok(candidates.some(c => c.type === "VENUE_PAYMENT_DUE"));
});

test("payment due dates reject calendar rollover and accept leap days", () => {
  for (const paymentDueDate of ["2030-02-30", "2030-04-31", "2030-13-01"])
    assert.throws(() => applyOperation(booking, record, { action: "DETAILS", paymentDueDate }, "owner", now), { status: 400 });
  assert.equal(applyOperation(booking, record, { action: "DETAILS", paymentDueDate: "2032-02-29" }, "owner", now).paymentDueDate.toISOString().slice(0, 10), "2032-02-29");
});
