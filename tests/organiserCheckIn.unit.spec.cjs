const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { bookingSessions, attendanceFor } = require("../services/bookingAttendance.service");
const venue = "507f1f77bcf86cd799439011";
const actor = "507f1f77bcf86cd799439012";
const now = new Date("2030-02-02T12:00:00Z");
const booking = (extra = {}) => ({ _id: "manual-one", eventCenter: venue, status: "ACTIVE", bookingUnit: "day", selectedDates: [{ date: "2030-02-01" }, { date: "2030-02-02" }, { date: "2030-02-03" }], ...extra });

test("consecutive hours merge but gaps and separate dates remain separate visits", () => {
  const sessions = bookingSessions(booking({ bookingUnit: "hour", selectedDates: [
    { date: "2030-02-01", startTime: "14:00", endTime: "15:00" },
    { date: "2030-02-01", startTime: "15:00", endTime: "17:00" },
    { date: "2030-02-01", startTime: "18:00", endTime: "19:00" },
    { date: "2030-02-02", startTime: "14:00", endTime: "17:00" },
  ] }));
  assert.equal(sessions.length, 3);
  assert.equal(sessions[0].startTime, "14:00");
  assert.equal(sessions[0].endTime, "17:00");
  assert.equal(sessions[0].startsAt, "2030-02-01T13:00:00.000Z");
});
test("day bookings remain one visit per date including duplicates", () => {
  assert.equal(bookingSessions(booking({ selectedDates: [{ date: "2030-02-01" }, { date: "2030-02-01" }, { date: "2030-02-02" }] })).length, 2);
});
test("ended sessions are unconfirmed, never automatically no-show", () => {
  const state = attendanceFor(booking(), [], now);
  assert.deepEqual(state.sessions.map(s => s.status), ["UNCONFIRMED", "AWAITING_CHECK_IN", "UPCOMING"]);
  assert.equal(state.summary.noShow, 0);
  assert.equal(state.sessions[0].canMarkNoShow, true);
  assert.equal(state.sessions[1].canMarkNoShow, false);
  assert.equal(state.sessions[2].canMarkAttended, false);
});
test("attendance remains independent for each session and payment is untouched", () => {
  const b = booking({ paymentStatus: "COMPLETED", totalPrice: { amount: 1500 } });
  const before = JSON.stringify(b);
  const sessions = bookingSessions(b);
  const state = attendanceFor(b, [{ sessionId: sessions[0].sessionId, status: "ATTENDED", revision: 1 }, { sessionId: sessions[1].sessionId, status: "NO_SHOW", revision: 1 }], now);
  assert.equal(state.summary.attended, 1);
  assert.equal(state.summary.noShow, 1);
  assert.equal(state.summary.upcoming, 1);
  assert.equal(JSON.stringify(b), before);
});
test("legacy check-in only counts on its matching date", () => {
  const state = attendanceFor(booking({ checkIn: { isCheckedIn: true, checkedInAt: "2030-02-01T12:00:00Z" } }), [], now);
  assert.equal(state.summary.attended, 1);
  assert.equal(state.sessions[1].status, "AWAITING_CHECK_IN");
  assert.equal(state.legacyUnassigned, false);
  assert.equal(attendanceFor(booking({ checkIn: { isCheckedIn: true, checkedInAt: "2029-01-01" } }), [], now).legacyUnassigned, true);
});
test("rescheduling does not copy old session attendance to new dates", () => {
  const old = bookingSessions(booking())[0];
  const state = attendanceFor(booking({ selectedDates: [{ date: "2030-03-01" }] }), [{ sessionId: old.sessionId, status: "ATTENDED", revision: 1 }], now);
  assert.equal(state.summary.attended, 0);
});
test("midnight boundaries and date timestamps use venue time", () => {
  const sessions = bookingSessions(booking({ selectedDates: [{ date: new Date("2030-02-01T23:00:00Z") }] }));
  assert.equal(sessions[0].date, "2030-02-02");
  assert.equal(sessions[0].endsAt, "2030-02-02T23:00:00.000Z");
  const hourly = booking({ bookingUnit: "hour", selectedDates: [{ date: "2030-02-02", startTime: "23:00", endTime: "00:00" }] });
  assert.equal(bookingSessions(hourly)[0].endTime, "24:00");
});

function serviceFixture() {
  const records = new Map();
  const model = {
    find: filter => ({ lean: async () => [...records.values()].filter(row => String(row.eventCenter) === String(filter.eventCenter) && row.bookingId === filter.bookingId) }),
    create: async record => { if (records.has(record._id)) throw Object.assign(new Error("duplicate"), { code: 11000 }); records.set(record._id, record); return record; },
    findOneAndUpdate: async (filter, update) => {
      const row = records.get(filter._id);
      if (!row || row.revision !== filter.revision) return null;
      row.status = update.$set.status; row.revision++; row.audit.push(update.$push.audit); return row;
    },
  };
  const sandbox = { module: { exports: {} }, process, Date, Intl, console, require: id => { assert.equal(id, "../models/client/bookingAttendance.schema"); return model; } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../services/bookingAttendance.service"), "utf8"), sandbox);
  const b = booking();
  const sessions = bookingSessions(b);
  const save = (extra = {}) => sandbox.module.exports.saveAttendance({ eventCenterId: venue, bookingId: b._id, booking: b, sessionId: sessions[1].sessionId, status: "ATTENDED", expectedRevision: 0, actor, proofVerified: true, now, ...extra });
  return { save, records, sessions };
}
test("current-session check-in persists actor, proof and an atomic audit entry", async () => {
  const f = serviceFixture(); await f.save();
  const record = [...f.records.values()][0];
  assert.equal(record.status, "ATTENDED"); assert.equal(record.audit[0].actor, actor);
  assert.equal(record.audit[0].proofVerified, true); assert.equal(record.audit.length, 1);
});
test("duplicate or simultaneous check-in creates one record", async () => {
  const f = serviceFixture(); const outcomes = await Promise.allSettled([f.save(), f.save()]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(x => x.status === "rejected").reason.status, 409);
  assert.equal(f.records.size, 1);
});
test("past attendance decisions require a reason", async () => {
  const f = serviceFixture();
  await assert.rejects(f.save({ sessionId: f.sessions[0].sessionId, status: "NO_SHOW" }), { status: 400 });
  await assert.rejects(f.save({ sessionId: f.sessions[0].sessionId }), { status: 400 });
  assert.equal(f.records.size, 0);
});
test("no-show can be corrected to attended with an immutable previous audit entry", async () => {
  const f = serviceFixture(); const sessionId = f.sessions[0].sessionId;
  await f.save({ sessionId, status: "NO_SHOW", reason: "Guest did not arrive", proofVerified: false });
  await f.save({ sessionId, expectedRevision: 1, reason: "Receipt and staff confirmed attendance" });
  const record = [...f.records.values()][0];
  assert.equal(record.status, "ATTENDED"); assert.equal(record.revision, 2);
  assert.equal(record.audit[0].status, "NO_SHOW"); assert.equal(record.audit[1].previousStatus, "NO_SHOW");
});
test("stale correction cannot overwrite a newer decision", async () => {
  const f = serviceFixture(); const sessionId = f.sessions[0].sessionId;
  await f.save({ sessionId, status: "NO_SHOW", reason: "Did not arrive" });
  await assert.rejects(f.save({ sessionId, expectedRevision: 0, reason: "Late report" }), { status: 409 });
});
test("future check-ins, ongoing no-shows, and missing proof are rejected", async () => {
  const f = serviceFixture();
  await assert.rejects(f.save({ sessionId: f.sessions[2].sessionId }), { status: 400 });
  await assert.rejects(f.save({ status: "NO_SHOW", reason: "Not here yet" }), { status: 400 });
  await assert.rejects(f.save({ proofVerified: false }), { status: 400 });
});
test("cancelled and pending bookings reject attendance, completed bookings allow corrections", async () => {
  const f = serviceFixture();
  for (const status of ["CANCELLED", "PENDING_REVIEW"]) await assert.rejects(f.save({ booking: booking({ status }) }), { status: 400 });
  await f.save({ booking: booking({ status: "COMPLETED" }), sessionId: f.sessions[0].sessionId, reason: "Confirmed visit" });
});
test("removed or rescheduled session IDs cannot be updated", async () => {
  const f = serviceFixture(); await assert.rejects(f.save({ sessionId: "old-session" }), { status: 409 });
});

function controllerFixture(allowed) {
  let writes = 0;
  const mocks = {
    mongoose: require("mongoose"), "../../models/client/bookingAttendance.schema": {},
    "../../services/bookingAttendance.service": { saveAttendance: async payload => { writes++; return payload; }, attendanceFor },
  };
  const sandbox = { module: { exports: {} }, console, require: id => { assert.ok(id in mocks, id); return mocks[id]; } };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/client/bookingAttendance.controller"), "utf8"), sandbox);
  const calls = [];
  const handler = sandbox.module.exports.handlers(async (...args) => { calls.push(args); return { authorized: allowed, error: "Access denied" }; });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { run: async () => { await handler.update({ user: { id: actor }, params: { bookingId: "manual-one" }, body: { eventCenterId: venue, sessionId: "date", status: "ATTENDED", expectedRevision: 0, actor: "spoofed" } }, res); return res; }, calls, writes: () => writes };
}
test("view-only organisers cannot alter attendance", async () => {
  const f = controllerFixture(false); const res = await f.run(); assert.equal(res.code, 403); assert.equal(f.writes(), 0); assert.equal(f.calls[0][2], false);
});
test("attendance actor comes from authentication, not the request", async () => {
  const f = controllerFixture(true); const res = await f.run(); assert.equal(res.body.data.actor, actor); assert.equal(f.writes(), 1);
});

test("attendance schema validates actor, status and proof audit without a database", async () => {
  const Model = require("../models/client/bookingAttendance.schema");
  const document = new Model({ _id: "session", eventCenter: venue, bookingId: "manual-one", sessionId: "2030-02-01:0-1440", status: "ATTENDED", revision: 1, audit: [{ actor, status: "ATTENDED", at: now, method: "MANUAL", proofVerified: true, reason: "Verified" }] });
  await document.validate();
  assert.equal(document.audit[0].reason, "Verified");
  assert.equal(String(document.audit[0].actor), actor);
  document.status = "COMPLETED";
  await assert.rejects(document.validate());
});
test("platform booking lookup is scoped to the requested venue", async () => {
  const platformId = "507f1f77bcf86cd799439013";
  let filter;
  const mocks = {
    mongoose: require("mongoose"),
    "../models/client/eventCenterBooking.schema": { findOne: value => { filter = value; return { lean: async () => null }; } },
    "../models/client/eventCenter.schema": { findById: () => ({ lean: async () => null }) },
  };
  const sandbox = { module: { exports: {} }, process, Date, Intl, require: id => { assert.ok(id in mocks, id); return mocks[id]; } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../services/bookingAttendance.service"), "utf8"), sandbox);
  await assert.rejects(sandbox.module.exports.loadBooking(venue, platformId), { status: 404 });
  assert.equal(filter._id, platformId); assert.equal(filter.eventCenter, venue);
});
