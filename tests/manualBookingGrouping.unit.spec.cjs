const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the update controller without a database or external services.
function controllerHarness(availability = { unavailableDates: [] }, options = {}) {
  let saved = { createdBy: "owner", availability, ...(options.updatedAt ? { updatedAt: new Date(options.updatedAt) } : {}) };
  const EventCenter = {
    findById: async () => ({ ...saved, toObject: () => ({ ...saved }) }),
    findByIdAndUpdate: async (_id, update) => {
      // Use the actual schema for Date casting and nested validation, then serialize as HTTP JSON.
      const Venue = require("../models/client/eventCenter.schema");
      const document = new Venue({ availability: update.availability });
      for (const entry of [...document.availability.unavailableDates, ...document.availability.unavailableSlots]) {
        const error = entry.validateSync();
        if (error) throw error;
      }
      saved = { ...saved, ...update, availability: JSON.parse(JSON.stringify(document.availability)) };
      return saved;
    },
  };
  EventCenter.findOneAndUpdate = async (filter, update) => {
    assert.equal(new Date(filter.updatedAt).getTime(), new Date(saved.updatedAt).getTime());
    if (options.race) return null;
    return EventCenter.findByIdAndUpdate(filter._id, update);
  };
  const context = {
    module: { exports: {} },
    console,
    require(name) {
      if (name.endsWith("/eventCenter.schema")) return EventCenter;
      if (name.endsWith("/bookingOperations.schema")) return { find: () => ({ lean: async () => options.ledgers || [] }) };
      if (name.endsWith("/bookingOperations.service")) return require("../services/bookingOperations.service");
      if (name === "crypto") return require("node:crypto");
      if (name === "mongoose") return { Types: { ObjectId: { isValid: () => true } } };
      if (name.endsWith("/eventCenterSettings.service")) {
        return { getEventCenterSettings: async () => ({}), validateVenuePayload: () => [] };
      }
      return {};
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../controllers/client/eventCenter.controller.js"), "utf8"), context);
  return async (entries, field = "unavailableDates", expectedStatus = 200) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await context.module.exports.updateEventCenter({
      params: { id: "venue" }, user: { id: "owner" },
      body: { availability: { [field]: entries }, expectedUpdatedAt: options.expectedUpdatedAt },
    }, res);
    assert.equal(res.code, expectedStatus, JSON.stringify(res.body));
    return expectedStatus === 200 ? res.body.data.availability[field] : res.body;
  };
}

const manual = (date, bookingId) => ({ date, type: "MANUAL", bookingId, clientName: "Test Client", totalPrice: 5000 });

for (const [unit, dates] of [
  ["dates", ["2027-01-10", "2027-01-11", "2027-01-15"]],
  ["hours", ["2027-01-10T10:00:00", "2027-01-10T11:00:00", "2027-01-11T09:00:00"]],
]) {
  test(`manual ${unit} keep one booking ID through creation, payment edits and rescheduling`, async () => {
    const update = controllerHarness();
    const bookingId = "manual-1800000000000";
    let entries = await update(dates.map(date => manual(date, bookingId)));
    assert.deepEqual(entries.map(entry => entry.bookingId), dates.map(() => bookingId));
    entries = await update(entries.map(entry => ({ ...entry, paymentStatus: "paid" })));
    assert.ok(entries.every(entry => entry.bookingId === bookingId));
    entries = await update(entries.map(entry => ({ ...entry, date: entry.date.replace("2027-01", "2027-02") })));
    assert.ok(entries.every(entry => entry.bookingId === bookingId));
  });
}

test("separate bookings for the same client stay separate and existing server IDs stay stable", async () => {
  const update = controllerHarness();
  const ids = ["manual-1800000000000", "manual-abcdef0123456789"];
  const entries = await update(ids.map((id, i) => manual(`2027-01-${10 + i}`, id)));
  assert.deepEqual(entries.map(entry => entry.bookingId), ids);
});

test("manual entry without an ID receives a stable fallback ID", async () => {
  const update = controllerHarness();
  const entries = await update([manual("2027-01-10")]);
  assert.match(entries[0].bookingId, /^manual-[a-f0-9]{16}$/);
  const savedAgain = await update(entries);
  assert.equal(savedAgain[0].bookingId, entries[0].bookingId);
});
test("hourly slots survive schema serialization, payment edits and rescheduling as one booking", async () => {
  const update = controllerHarness();
  let slots = ["10:00", "11:00"].map((startTime, i) => ({
    ...manual("2027-01-10", "manual-group"), startTime, endTime: `${11 + i}:00`,
  }));
  slots = await update(slots, "unavailableSlots");
  assert.deepEqual(slots.map(s => s.startTime), ["10:00", "11:00"]);
  assert.ok(slots.every(s => s.bookingId === "manual-group"));
  slots = await update(slots.map(s => ({ ...s, paymentStatus: "paid" })), "unavailableSlots");
  assert.ok(slots.every(s => s.paymentStatus === "paid" && s.bookingId === "manual-group"));
  slots = await update(slots.map(s => ({ ...s, date: "2027-01-15" })), "unavailableSlots");
  assert.ok(slots.every(s => s.date.startsWith("2027-01-15") && s.bookingId === "manual-group"));
});

test("manual slot rejects platform overlap but permits a neighbouring hour", async () => {
  const booked = { date: "2027-01-10", startTime: "10:00", endTime: "12:00", type: "BOOKED", bookingId: "platform" };
  const update = controllerHarness({ unavailableSlots: [booked] });
  const entry = { ...manual("2027-01-10", "manual-new"), startTime: "11:00", endTime: "12:00" };
  await update([booked, entry], "unavailableSlots", 400);
  const result = await update([booked, { ...entry, startTime: "12:00", endTime: "13:00" }], "unavailableSlots");
  assert.equal(result.length, 2);
  await update([manual("2027-01-10", "manual-day")], "unavailableDates", 400);
});

test("invalid manual time ranges return a validation error", async () => {
  const update = controllerHarness();
  await update([{ ...manual("2027-01-10", "manual-bad"), startTime: "15:00", endTime: "14:00" }], "unavailableSlots", 400);
});

test("manual bookings cannot overlap one another or blocked periods", async () => {
  const update = controllerHarness();
  await update([manual("2027-01-10", "one"), manual("2027-01-10", "two")], "unavailableDates", 400);
  await update([manual("2027-01-10", "one"), { date: "2027-01-10", type: "BLOCKED" }], "unavailableDates", 400);
});
test("platform dates cannot be removed through manual calendar saves", async () => {
  const booked = { date: "2027-01-10", type: "BOOKED", bookingId: "platform" };
  const result = await controllerHarness({ unavailableDates: [booked] })([]);
  assert.equal(result.length, 1); assert.equal(result[0].bookingId, "platform");
});
test("missing or stale calendar versions reject the save", async () => {
  const updatedAt = "2026-09-28T12:00:00Z";
  await controllerHarness({ unavailableDates: [] }, { updatedAt })([manual("2027-01-10", "one")], "unavailableDates", 409);
  await controllerHarness({ unavailableDates: [] }, { updatedAt, expectedUpdatedAt: "2026-09-27T12:00:00Z" })([manual("2027-01-10", "one")], "unavailableDates", 409);
});
test("calendar compare-and-set rejects a concurrent write after validation", async () => {
  const updatedAt = "2026-09-28T12:00:00Z";
  await controllerHarness({ unavailableDates: [] }, { updatedAt, expectedUpdatedAt: updatedAt, race: true })([manual("2027-01-10", "one")], "unavailableDates", 409);
});

test("calendar edits cannot overwrite ledger collections", async () => {
  const update = controllerHarness({}, { ledgers: [{ bookingId: "manual-ledger", openingPaidMinor: 10000, payments: [{ kind: "PAYMENT", amountMinor: 20000 }] }] });
  const entries = await update([{ ...manual("2027-01-10", "manual-ledger"), depositAmount: 0, paymentStatus: "pending" }]);
  assert.equal(entries[0].depositAmount, 300); assert.equal(entries[0].paymentStatus, "partially_paid");
});
test("calendar price edits cannot fall below recorded collections", async () => {
  const update = controllerHarness({}, { ledgers: [{ bookingId: "manual-ledger", openingPaidMinor: 30000, payments: [] }] });
  await update([{ ...manual("2027-01-10", "manual-ledger"), totalPrice: 200 }], "unavailableDates", 400);
});
