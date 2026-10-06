// Disposable replica set only; application credentials are never loaded.
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Venue = require("../models/client/eventCenter.schema");
const Operations = require("../models/client/bookingOperations.schema");
const { saveOperation } = require("../services/bookingOperations.service");
test("payment ledger persists atomically and rechecks current calendar state", { timeout: 120000 }, async t => {
  let database;
  try {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri(), { dbName: "isolated_booking_operations" });
    await Operations.init();
    const actor = new mongoose.Types.ObjectId();
    async function fixture() {
      const venueId = new mongoose.Types.ObjectId();
      await Venue.collection.insertOne({ _id: venueId, createdBy: actor, basePrice: { unit: "day", currency: "NGN" }, availability: { unavailableDates: [{ date: new Date("2030-01-02"), type: "MANUAL", bookingId: "manual-1", totalPrice: 100, paymentStatus: "pending", depositAmount: 0 }], unavailableSlots: [] } });
      return { venueId, booking: { _id: "manual-1", bookingType: "MANUAL", status: "ACTIVE", totalPrice: { amount: 1000, currency: "NGN" }, paymentStatus: "PENDING" } };
    }
    const payload = { action: "PAYMENT", id: "payment-one", kind: "PAYMENT", amount: 40, method: "CASH", expectedRevision: 0 };
    await t.test("stale price cannot permit overpayment", async () => {
      const { venueId, booking } = await fixture();
      await assert.rejects(saveOperation(venueId, booking, { ...payload, amount: 101 }, actor), { status: 400 });
      assert.equal(await Operations.countDocuments({ eventCenter: venueId }), 0);
    });
    await t.test("cancelled manual booking cannot collect payment", async () => {
      const { venueId, booking } = await fixture();
      await Venue.collection.updateOne({ _id: venueId }, { $set: { "availability.unavailableDates": [] } });
      await assert.rejects(saveOperation(venueId, booking, payload, actor), { status: 400 });
      assert.equal(await Operations.countDocuments({ eventCenter: venueId }), 0);
    });
    await t.test("simultaneous payments cannot overwrite each other", async () => {
      const { venueId, booking } = await fixture();
      const results = await Promise.allSettled([saveOperation(venueId, booking, payload, actor), saveOperation(venueId, booking, { ...payload, id: "payment-two" }, actor)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
      const saved = await Operations.findOne({ eventCenter: venueId }).lean();
      assert.equal(saved.payments.length, 1); assert.equal(saved.revision, 1);
      const venue = await Venue.findById(venueId).lean();
      assert.equal(venue.availability.unavailableDates[0].depositAmount, 40);
      assert.equal(venue.availability.unavailableDates[0].paymentStatus, "partially_paid");
      await saveOperation(venueId, booking, { ...payload, id: saved.payments[0].id }, actor);
      assert.equal((await Operations.findOne({ eventCenter: venueId }).lean()).payments.length, 1);
    });
  } finally { await mongoose.disconnect(); if (database) await database.stop(); }
});
