// Isolated disposable database; never loads application credentials or downloads MongoDB.
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Attendance = require("../models/client/bookingAttendance.schema");
const { bookingSessions, saveAttendance } = require("../services/bookingAttendance.service");
test("session attendance and corrections persist atomically under concurrent requests", { timeout: 60000 }, async () => {
  let database;
  try {
    database = await MongoMemoryServer.create();
    await mongoose.connect(database.getUri(), { dbName: "isolated_session_attendance" });
    await Attendance.init();
    const eventCenterId = String(new mongoose.Types.ObjectId());
    const actor = String(new mongoose.Types.ObjectId());
    const booking = { _id: "manual-one", eventCenter: eventCenterId, status: "COMPLETED", bookingUnit: "day", selectedDates: [{ date: "2030-02-01" }, { date: "2030-02-02" }] };
    const sessions = bookingSessions(booking);
    const payload = { booking, eventCenterId, bookingId: booking._id, actor, sessionId: sessions[0].sessionId, status: "NO_SHOW", expectedRevision: 0, reason: "Guest did not arrive", now: new Date("2030-03-01") };
    const outcomes = await Promise.allSettled([saveAttendance(payload), saveAttendance(payload)]);
    assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(outcomes.find(x => x.status === "rejected").reason.status, 409);
    await saveAttendance({ ...payload, status: "ATTENDED", expectedRevision: 1, proofVerified: true, reason: "Visit confirmed by organiser" });
    const saved = await Attendance.findOne({ bookingId: booking._id }).lean();
    assert.equal(saved.revision, 2); assert.equal(saved.audit.length, 2);
    assert.equal(saved.audit[0].status, "NO_SHOW"); assert.equal(saved.audit[1].status, "ATTENDED");
    assert.equal(String(saved.audit[1].actor), actor);
    assert.equal(await Attendance.countDocuments({ sessionId: sessions[1].sessionId }), 0);
  } finally { await mongoose.disconnect(); if (database) await database.stop(); }
});
