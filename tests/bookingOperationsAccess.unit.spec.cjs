const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const venueId = "507f1f77bcf86cd799439011";
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
function operationsFixture({ authorized = true, finance = false } = {}) {
  let writes = 0;
  const venue = { _id: venueId, createdBy: "owner", capacity: { max: 100 } };
  const record = { payments: [{ amountMinor: 10000 }], openingPaidMinor: 5000, privateNotes: "Internal" };
  const sandbox = { exports: {}, console, require(id) {
    if (id === "mongoose") return { Types: { ObjectId: { isValid: () => true } } };
    if (id.endsWith("eventCenter.schema")) return { findById: () => ({ lean: async () => venue }) };
    if (id.includes("Invitation.schema")) return { findOne: () => ({ lean: async () => finance ? {} : null }) };
    if (id.endsWith("bookingAttendance.service")) return { loadBooking: async () => ({ _id: "manual-1" }), attendanceForBookings: async () => [{ attendance: { sessions: [] } }] };
    if (id.endsWith("bookingOperations.service")) return { getRecord: async () => record, paymentSummary: () => ({ paidMinor: 15000 }), confirmationText: () => "Confirmation", saveOperation: async () => { writes++; return { revision: 1 }; } };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/client/bookingOperations.controller"), "utf8"), sandbox);
  return { handlers: sandbox.exports.handlers(async () => ({ authorized, error: "Denied" })), writes: () => writes };
}
const req = body => ({ user: { id: "staff" }, params: { bookingId: "manual-1" }, query: { eventCenterId: venueId }, body: { eventCenterId: venueId, ...body } });
test("booking managers without finance permission cannot read ledger amounts", async () => {
  const f = operationsFixture(); const res = response(); await f.handlers.details(req(), res);
  assert.equal(res.code, 200); assert.equal(res.body.data.summary, null);
  assert.equal(res.body.data.record.openingPaidMinor, undefined); assert.equal(res.body.data.record.payments.length, 0);
  assert.equal(res.body.data.confirmation, null);
});
test("payment and due-date writes require finance permission", async () => {
  const f = operationsFixture();
  for (const body of [{ action: "PAYMENT" }, { action: "DETAILS", paymentDueDate: "2030-01-01" }]) {
    const res = response(); await f.handlers.update(req(body), res); assert.equal(res.code, 403);
  }
  assert.equal(f.writes(), 0);
});
test("finance permission alone does not bypass venue booking authorization", async () => {
  const f = operationsFixture({ authorized: false, finance: true }); const res = response();
  await f.handlers.update(req({ action: "PAYMENT" }), res); assert.equal(res.code, 403); assert.equal(f.writes(), 0);
});
test("handover requires attended session and guest count respects venue capacity", async () => {
  const f = operationsFixture();
  for (const body of [{ action: "HANDOVER", sessionId: "unknown" }, { action: "DETAILS", guestCount: 101 }]) {
    const res = response(); await f.handlers.update(req(body), res); assert.equal(res.code, 400);
  }
  assert.equal(f.writes(), 0);
});
function scannerFixture({ authorized = true, failure } = {}) {
  const calls = [];
  const ticket = { ticketNumber: "TICKET", eventCenter: { _id: venueId, venueName: "Hall" } };
  const source = fs.readFileSync(require.resolve("../controllers/client/eventCenterTicket.controller"), "utf8");
  const start = source.indexOf("const validateTicket = async");
  const end = source.indexOf("const getTicketById = async", start);
  const sandbox = { module: { exports: {} }, console: { error() {} }, verifyQRPayload: () => ({ valid: true, data: { tn: "TICKET" } }),
    authorizeScanAccess: async () => ({ authorized, error: "Denied" }),
    EventCenterBooking: { findOne() { return { select() { return this; }, lean: async () => ({ eventCenter: venueId }), populate() { return this; }, then(resolve) { return Promise.resolve(ticket).then(resolve); } }; } },
    require: () => ({ checkInCurrentSession: async args => { calls.push(args); if (failure) throw Object.assign(new Error("Attendance conflict"), { status: failure }); return { recordedAt: "2030-01-01" }; } }),
  };
  vm.runInNewContext(source.slice(start, end) + "\nmodule.exports = validateTicket;", sandbox);
  return { scan: sandbox.module.exports, calls };
}
test("organiser QR scanner writes current-session attendance with verified proof", async () => {
  const f = scannerFixture(); const res = response(); await f.scan(req({ qrPayload: "signed" }), res);
  assert.equal(res.code, 200); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "QR"); assert.equal(f.calls[0].proofVerified, true); assert.equal(f.calls[0].eventCenterId, venueId);
});
test("organiser scanner preserves attendance conflicts and rejects unauthorized scans", async () => {
  for (const options of [{ failure: 409 }, { authorized: false }]) {
    const f = scannerFixture(options); const res = response(); await f.scan(req({ ticketNumber: "TICKET" }), res);
    assert.equal(res.code, options.failure || 403); if (!options.authorized && !options.failure) assert.equal(f.calls.length, 0);
  }
});
