const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Venue = require("../models/client/eventCenter.schema");
const Hold = require("../models/client/venueHold.schema");
const History = require("../models/client/bookingHistory.schema");
const service = require("../services/venueHold.service");
const venueId = "507f1f77bcf86cd799439011";
const holdId = "507f1f77bcf86cd799439012";
const future = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const stamp = new Date();
const setup = (extra = {}) => {
  let saved = 0, pushed;
  const venue = { _id: venueId, updatedAt: stamp, basePrice: { unit: "day", currency: "NGN" }, availability: { unavailableDates: [], unavailableSlots: [] }, save: async () => { saved++; }, ...extra };
  mock.method(mongoose.connection, "transaction", fn => fn({ transaction: true }));
  mock.method(Venue, "findById", () => ({ session: async () => venue }));
  mock.method(Venue, "updateOne", async (_filter, update, options) => { assert.ok(options.session); pushed = update; });
  mock.method(Hold, "create", async (documents, options) => { assert.ok(options.session); return [{ ...documents[0], _id: holdId }]; });
  return { venue, saved: () => saved, pushed: () => pushed };
};
const input = { clientName: "Ada", hours: 24, dates: [{ date: future }], expectedUpdatedAt: stamp.toISOString() };
afterEach(() => mock.restoreAll());
test("a hold blocks all selected dates under one hold ID", async () => {
  const f = setup();
  const result = await service.createHold(venueId, input, "owner");
  const entries = f.pushed().$push["availability.unavailableDates"].$each;
  assert.equal(entries[0].holdId, holdId); assert.equal(entries[0].type, "BLOCKED");
  assert.equal(result.clientName, "Ada"); assert.ok(result.expiresAt > stamp);
});
test("hold creation checks the calendar revision and conflicts", async () => {
  setup({ availability: { unavailableDates: [{ date: future, type: "MANUAL", bookingId: "other" }] } });
  await assert.rejects(service.createHold(venueId, { ...input, expectedUpdatedAt: "2000-01-01" }, "owner"), { status: 409 });
  await assert.rejects(service.createHold(venueId, input, "owner"), /available/);
});
test("invalid hold duration cannot reserve dates", async () => {
  for (const hours of [0, -1, 169, Infinity]) await assert.rejects(service.createHold(venueId, { ...input, hours }, "owner"), { status: 400 });
});
test("expired holds cannot be converted to a booking", async () => {
  setup(); mock.method(Hold, "findOne", filter => { assert.equal(filter.eventCenter, venueId); return { session: async () => ({ _id: holdId, status: "ACTIVE", expiresAt: new Date(0) }) }; });
  await assert.rejects(service.resolveHold(venueId, holdId, "CONFIRM", "owner", 100), { status: 409 });
});
test("releasing a hold keeps other bookings intact", async () => {
  const f = setup({ availability: { unavailableDates: [{ holdId }, { bookingId: "other", type: "BOOKED" }], unavailableSlots: [] } });
  const hold = { _id: holdId, status: "ACTIVE", expiresAt: new Date(Date.now() + 3600000), save: async () => {} };
  mock.method(Hold, "findOne", () => ({ session: async () => hold }));
  await service.resolveHold(venueId, holdId, "RELEASE", "owner");
  assert.equal(hold.status, "RELEASED"); assert.equal(f.venue.availability.unavailableDates.length, 1); assert.equal(f.venue.availability.unavailableDates[0].bookingId, "other");
});
test("confirming a hold creates one manual booking and its history atomically", async () => {
  const f = setup({ availability: { unavailableDates: [{ holdId }], unavailableSlots: [] } });
  const hold = { _id: holdId, status: "ACTIVE", expiresAt: new Date(Date.now() + 3600000), bookingUnit: "day", dates: [{ date: future }], clientName: "Ada", save: async () => {} };
  mock.method(Hold, "findOne", () => ({ session: async () => hold }));
  let history;
  mock.method(History, "create", async (rows, options) => { assert.ok(options.session); history = rows[0]; });
  await service.resolveHold(venueId, holdId, "CONFIRM", "owner", 1000);
  assert.equal(hold.status, "CONVERTED"); assert.equal(f.venue.availability.unavailableDates[0].bookingId, hold.bookingId);
  assert.equal(history.bookingId, hold.bookingId); assert.equal(history.totalPrice.amount, 1000);
});
