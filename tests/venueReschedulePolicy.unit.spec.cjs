const { test } = require("node:test"), assert = require("node:assert/strict");
const { rescheduleTerms } = require("../services/venueReschedulePolicy.service");
const base = { status: "CONFIRMED", paymentStatus: "COMPLETED", bookingUnit: "hour",
  selectedDates: [{ date: "2030-06-10", startTime: "12:00", endTime: "14:00" }],
  cancellationPolicy: { allowGuestReschedule: true, rescheduleNoticeHours: 48 } };
test("rescheduling notice uses the first Lagos session and includes the exact deadline", () => {
  assert.equal(rescheduleTerms(base).deadline.toISOString(), "2030-06-08T11:00:00.000Z");
  assert.equal(rescheduleTerms(base, new Date("2030-06-08T11:00:00Z")).canRequest, true);
  assert.equal(rescheduleTerms(base, new Date("2030-06-08T11:00:00.001Z")).canRequest, false);
  const daily = { ...base, bookingUnit: "day", selectedDates: [{ date: "2030-06-12" }, { date: "2030-06-10" }] };
  assert.equal(rescheduleTerms(daily).deadline.toISOString(), "2030-06-07T23:00:00.000Z");
});
test("disabled, ineligible and pending bookings cannot submit a rescheduling request", () => {
  for (const patch of [{ cancellationPolicy: { allowGuestReschedule: false } }, { status: "CANCELLED" },
    { paymentStatus: "PENDING" }, { checkIn: { isCheckedIn: true } }, { paymentResolutionRequired: true },
    { refund: { state: "QUEUED" } }, { rescheduleRequest: { status: "PENDING" } },
    { cancellationPolicy: { rescheduleNoticeHours: -1 } }, { cancellationPolicy: { rescheduleNoticeHours: 1.5 } }]) {
    assert.equal(rescheduleTerms({ ...base, ...patch }, new Date("2030-06-01")).canRequest, false);
  }
});
test("legacy requests retain zero-notice terms but cannot be submitted once the booking starts", () => {
  const legacy = { ...base, cancellationPolicy: undefined };
  assert.equal(rescheduleTerms(legacy, new Date("2030-06-10T10:59:59Z")).canRequest, true);
  assert.equal(rescheduleTerms(legacy, new Date("2030-06-10T11:00:00Z")).canRequest, false);
});
test("listing validation rejects malformed new policy settings and permits older policy payloads", () => {
  const { validateVenuePayload } = require("../services/eventCenterSettings.service");
  const settings = { contentLimits: {} };
  const policy = { allowGuestCancellation: false, noticeHours: 24, refundDays: 7, refundInstructions: "" };
  const validate = patch => validateVenuePayload({ cancellationPolicy: { ...policy, ...patch } }, settings, { existing: true });
  assert.deepEqual(validate({}), []);
  assert.deepEqual(validate({ allowGuestReschedule: false, rescheduleNoticeHours: 48, rescheduleNoticeUnit: "days" }), []);
  for (const patch of [{ allowGuestReschedule: "false" }, { rescheduleNoticeHours: -1 }, { rescheduleNoticeHours: 8761 },
    { rescheduleNoticeHours: 0.5 }, { noticeUnit: "weeks" }, { rescheduleNoticeUnit: "months" }]) assert.ok(validate(patch).length);
});

test("saved limits count approved changes and leave legacy terms intact", () => {
  const limited = { ...base, cancellationPolicy: { ...base.cancellationPolicy, maxReschedules: 2 } };
  for (const status of ["DECLINED", "WITHDRAWN", "CANCELLED"]) {
    const terms = rescheduleTerms({ ...limited, rescheduleCount: 1, rescheduleRequest: { status } }, new Date("2030-06-01"));
    assert.equal(terms.canRequest, true);
    assert.equal(terms.remainingReschedules, 1);
  }
  const exhausted = rescheduleTerms({ ...limited, rescheduleCount: 2 }, new Date("2030-06-01"));
  assert.equal(exhausted.canRequest, false);
  assert.equal(exhausted.remainingReschedules, 0);
  assert.match(exhausted.reason, /used all/);
  const legacy = rescheduleTerms({ ...base, rescheduleCount: 8 }, new Date("2030-06-01"));
  assert.equal(legacy.canRequest, true);
  assert.equal(legacy.maxReschedules, null);
  assert.equal(legacy.remainingReschedules, null);
});
test("new listing default is one without changing hydrated legacy booking terms", () => {
  const Venue = require("../models/client/eventCenter.schema");
  const Booking = require("../models/client/eventCenterBooking.schema");
  assert.equal(new Venue().cancellationPolicy.maxReschedules, 1);
  assert.equal(new Venue({ cancellationPolicy: {} }).cancellationPolicy.maxReschedules, 1);
  const legacy = Booking.hydrate({ ...base, rescheduleCount: 4 });
  assert.equal(legacy.cancellationPolicy.maxReschedules, undefined);
  assert.equal(rescheduleTerms(legacy, new Date("2030-06-01")).canRequest, true);
});
test("listing rejects invalid reschedule limits including disabled policy payloads", () => {
  const { validateVenuePayload } = require("../services/eventCenterSettings.service");
  const policy = { allowGuestCancellation: false, noticeHours: 24, refundDays: 7, refundInstructions: "", allowGuestReschedule: false };
  for (const maxReschedules of [0, -1, 1.5, 101, null, "2"]) {
    assert.ok(validateVenuePayload({ cancellationPolicy: { ...policy, maxReschedules } }, { contentLimits: {} }, { existing: true }).length);
  }
  for (const maxReschedules of [1, 2, 100]) {
    assert.deepEqual(validateVenuePayload({ cancellationPolicy: { ...policy, maxReschedules } }, { contentLimits: {} }, { existing: true }), []);
  }
});
