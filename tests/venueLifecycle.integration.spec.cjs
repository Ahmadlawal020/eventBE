process.env.NODE_ENV = "test";
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
process.env.QR_SIGNING_SECRET = "test-only-secret";
const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Booking = require("../models/client/eventCenterBooking.schema");
const Venue = require("../models/client/eventCenter.schema");
const Payout = require("../models/client/venuePayout.schema");
const History = require("../models/client/bookingHistory.schema");
const lifecycle = require("../services/venueLifecycle.service");
const { processVenueRefund } = require("../services/venueRefund.service");
const gateway = require("../services/payment/adapters/paystack.adapter").prototype;
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
test("venue lifecycle uses atomic writes and recoverable provider operations", { timeout: 120000 }, async t => {
  let db;
  try {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri(), { dbName: "isolated_venue_lifecycle" });
    await Promise.all([Booking.init(), Venue.init(), Payout.init(), History.init(), require("../models/client/eventCenterRefundOutbox.schema").init()]);
    async function fixture({ payoutStatus, status = "ACTIVE" } = {}) {
      const actor = new mongoose.Types.ObjectId(), id = new mongoose.Types.ObjectId(), venueId = new mongoose.Types.ObjectId();
      await Venue.collection.insertOne({ _id: venueId, createdBy: actor, status: "LISTED", basePrice: { amount: 1000, currency: "NGN", unit: "day" }, availability: { unavailableDates: [{ date: new Date(day(30)), type: "BOOKED", bookingId: String(id) }], unavailableSlots: [] } });
      const booking = await Booking.create({ _id: id, buyer: new mongoose.Types.ObjectId(), organiser: actor, eventCenter: venueId, selectedDates: [{ date: day(30) }], bookingUnit: "day", duration: 1, subtotalPrice: { amount: 1000, currency: "NGN" }, totalPrice: { amount: 1000, currency: "NGN" }, paymentStatus: "COMPLETED", paymentReference: String(id), status });
      if (payoutStatus) await Payout.create({ booking: id, organiser: actor, reference: "payout-" + id, amountMinor: 100000, currency: "NGN", destination: { bankCode: "001", accountNumber: "0000000000" }, status: payoutStatus });
      return { actor, id, venueId, booking };
    }
    await t.test("concurrent cancellation records one refund intent and cancels a ready payout", async () => {
      const f = await fixture({ status: "CONFIRMED", payoutStatus: "READY" });
      await Promise.all([lifecycle.cancelVenueBooking(f.id, { actor: f.actor }), lifecycle.cancelVenueBooking(f.id, { actor: f.actor })]);
      const booking = await Booking.findById(f.id);
      assert.equal(booking.status, "CANCELLED"); assert.equal(booking.refund.state, "QUEUED");
      assert.equal((await Payout.findOne({ booking: f.id })).status, "CANCELLED");
      assert.equal((await Venue.findById(f.venueId)).availability.unavailableDates.length, 0);
      assert.equal(await History.countDocuments({ ticket: f.id, action: "CANCELLED" }), 1);
    });
    await t.test("started payout prevents cancellation and leaves inventory intact", async () => {
      const f = await fixture({ status: "CONFIRMED", payoutStatus: "SUBMITTING" });
      await assert.rejects(lifecycle.cancelVenueBooking(f.id, { actor: f.actor }), { statusCode: 409 });
      assert.equal((await Booking.findById(f.id)).status, "CONFIRMED");
      assert.equal((await Venue.findById(f.venueId)).availability.unavailableDates.length, 1);
    });
    await t.test("history failure rolls back cancellation and calendar changes", async () => {
      const f = await fixture(); const stub = mock.method(History, "create", async () => { throw Error("audit unavailable"); });
      try { await assert.rejects(lifecycle.cancelVenueBooking(f.id, { actor: f.actor }), /audit unavailable/); }
      finally { stub.mock.restore(); }
      assert.equal((await Booking.findById(f.id)).status, "ACTIVE");
      assert.equal((await Venue.findById(f.venueId)).availability.unavailableDates.length, 1);
    });
    await t.test("reschedule enforces blocks, duration and atomic inventory movement", async () => {
      const f = await fixture();
      await Venue.updateOne({ _id: f.venueId }, { $push: { "availability.unavailableDates": { date: day(31), type: "BLOCKED" } } });
      await assert.rejects(lifecycle.rescheduleVenueBooking(f.id, [{ date: day(31) }], f.actor));
      await assert.rejects(lifecycle.rescheduleVenueBooking(f.id, [{ date: day(32) }, { date: day(33) }], f.actor), { statusCode: 409 });
      await lifecycle.rescheduleVenueBooking(f.id, [{ date: day(32) }], f.actor);
      assert.equal((await Booking.findById(f.id)).selectedDates[0].date.toISOString().slice(0, 10), day(32));
      const entries = (await Venue.findById(f.venueId)).availability.unavailableDates;
      assert.equal(entries.some(e => e.date.toISOString().slice(0, 10) === day(30)), false);
      assert.equal(entries.some(e => e.date.toISOString().slice(0, 10) === day(31)), true);
    });
    await t.test("concurrent reschedules cannot sell the same date twice", async () => {
      const f = await fixture();
      const second = await Booking.create({ ...f.booking.toObject(), _id: new mongoose.Types.ObjectId(), selectedDates: [{ date: day(34) }], paymentReference: "second-" + f.id });
      await Venue.updateOne({ _id: f.venueId }, { $push: { "availability.unavailableDates": { date: day(34), type: "BOOKED", bookingId: String(second._id) } } });
      const results = await Promise.allSettled([lifecycle.rescheduleVenueBooking(f.id, [{ date: day(35) }], f.actor), lifecycle.rescheduleVenueBooking(second._id, [{ date: day(35) }], f.actor)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    });
    await t.test("archiving preserves records and refuses outstanding obligations", async () => {
      const f = await fixture();
      await assert.rejects(lifecycle.archiveVenue(f.venueId, f.actor), { statusCode: 409 });
      await Booking.updateOne({ _id: f.id }, { $set: { status: "COMPLETED" } });
      await lifecycle.archiveVenue(f.venueId, f.actor);
      assert.ok((await Venue.findById(f.venueId)).archivedAt);
      assert.equal((await Venue.updateOne({ _id: f.venueId }, { $set: { status: "LISTED" } })).modifiedCount, 0);
      assert.ok(await Booking.findById(f.id));
      const archived = await Venue.findById(f.venueId);
      archived.status = "LISTED";
      await assert.rejects(archived.save(), /Archived venues cannot be republished/);
    });
    await t.test("expired review and repeated decline persist one refund and history entry", async () => {
      const f = await fixture({ status: "PENDING_REVIEW" });
      await Booking.updateOne({ _id: f.id }, { $set: { reviewDeadline: new Date(Date.now() - 1000) } });
      await lifecycle.cancelVenueBooking(f.id, { mode: "expire", reason: "Review deadline expired" });
      await lifecycle.cancelVenueBooking(f.id, { mode: "decline", actor: f.actor });
      const booking = await Booking.findById(f.id);
      assert.equal(booking.refund.state, "QUEUED");
      assert.equal(await History.countDocuments({ ticket: f.id }), 1);
      assert.equal((await Venue.findById(f.venueId)).availability.unavailableDates.length, 0);
    });
    await t.test("payout claim prevents cancellation while transfer preparation is running", async () => {
      const f = await fixture({ status: "CONFIRMED", payoutStatus: "READY" });
      let entered, release, submitted = 0;
      const started = new Promise(resolve => { entered = resolve; });
      const paused = new Promise(resolve => { release = resolve; });
      const stubs = [mock.method(gateway, "createTransferRecipient", async () => { entered(); await paused; return { recipient_code: "recipient" }; }),
        mock.method(gateway, "transferToOrganiser", async () => { submitted++; return { status: "success" }; })];
      const payout = await Payout.findOne({ booking: f.id });
      const running = require("../services/venuePayout.service").processVenuePayout(payout._id);
      try {
        await started;
        await assert.rejects(lifecycle.cancelVenueBooking(f.id, { actor: f.actor }), { statusCode: 409 });
        release(); await running;
        assert.equal(submitted, 1); assert.equal((await Booking.findById(f.id)).status, "CONFIRMED");
      } finally { release(); await running; stubs.forEach(s => s.mock.restore()); }
    });
    await t.test("cancelled payout is never submitted by a later worker", async () => {
      const f = await fixture({ status: "CONFIRMED", payoutStatus: "READY" });
      await lifecycle.cancelVenueBooking(f.id, { actor: f.actor });
      const stub = mock.method(gateway, "transferToOrganiser", async () => { throw Error("Unexpected transfer"); });
      try {
        await require("../services/venuePayout.service").processVenuePayout((await Payout.findOne({ booking: f.id }))._id);
        assert.equal(stub.mock.callCount(), 0);
      } finally { stub.mock.restore(); }
    });
    await t.test("late payment on a cancelled reservation queues one refund", async () => {
      const f = await fixture();
      await Booking.updateOne({ _id: f.id }, { $set: { paymentStatus: "PENDING" } });
      await lifecycle.cancelVenueBooking(f.id, { actor: f.actor });
      const complete = require("../services/checkoutSafety.service").completePayment;
      const payment = { reference: String(f.id), status: "success", amount: 100000, currency: "NGN" };
      await complete(String(f.id), payment, { kind: "EVENT_CENTER" });
      await complete(String(f.id), payment, { kind: "EVENT_CENTER" });
      const booking = await Booking.findById(f.id);
      assert.equal(booking.refund.state, "QUEUED"); assert.equal(booking.refund.amountMinor, 100000);
    });
    await t.test("refund request is submitted once, pending is not completion", async () => {
      const f = await fixture(); await lifecycle.cancelVenueBooking(f.id, { actor: f.actor });
      let submissions = 0;
      const post = mock.method(gateway, "refundPayment", async () => { submissions++; return { id: 99, amount: 100000, currency: "NGN", status: "pending" }; });
      const verify = mock.method(gateway, "verifyRefund", async () => ({ id: 99, amount: 100000, currency: "NGN", status: "processed" }));
      try {
        await Promise.all([processVenueRefund(f.id), processVenueRefund(f.id)]);
        assert.equal(submissions, 1); assert.equal((await Booking.findById(f.id)).refund.state, "PENDING");
        assert.equal((await Booking.findById(f.id)).paymentStatus, "COMPLETED");
        await Booking.updateOne({ _id: f.id }, { $set: { "refund.leaseUntil": new Date(0) } });
        await processVenueRefund(f.id);
        assert.equal((await Booking.findById(f.id)).paymentStatus, "REFUNDED"); assert.equal(submissions, 1);
      } finally { post.mock.restore(); verify.mock.restore(); }
    });
    await t.test("ambiguous refund submission reconciles by transaction without a second POST", async () => {
      const f = await fixture(); await lifecycle.cancelVenueBooking(f.id, { actor: f.actor });
      let submissions = 0;
      const stubs = [mock.method(gateway, "refundPayment", async () => { submissions++; throw Error("response lost"); }),
        mock.method(gateway, "verifyPayment", async () => ({ id: 123 })),
        mock.method(gateway, "listRefunds", async () => [{ id: 100, amount: 100000, currency: "NGN", status: "processed" }])];
      try {
        await processVenueRefund(f.id);
        assert.equal((await Booking.findById(f.id)).refund.state, "NEEDS_ATTENTION");
        await Booking.updateOne({ _id: f.id }, { $set: { "refund.leaseUntil": new Date(0) } });
        await processVenueRefund(f.id);
        assert.equal(submissions, 1); assert.equal((await Booking.findById(f.id)).paymentStatus, "REFUNDED");
      } finally { stubs.forEach(s => s.mock.restore()); }
    });
  } finally { mock.restoreAll(); await mongoose.disconnect(); if (db) await db.stop(); }
});
