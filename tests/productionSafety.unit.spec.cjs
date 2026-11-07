process.env.NODE_ENV = "test";
process.env.QR_SIGNING_SECRET = "test-only-secret";
const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { publicVenue, canReadPrivateVenue } = require("../services/publicVenue.service");
const { refundOutcome } = require("../services/venueRefund.service");
afterEach(() => mock.restoreAll());
test("public venue serialization removes guest records, staff identity and operational metadata", async () => {
  const venue = { _id: "v", venueName: "Hall", createdBy: { _id: "o", firstName: "Owner", email: "private@example.test" },
    staff: ["staff"], coOrganisers: ["co"], moderation: { reason: "private" }, performance: { revenue: 500 },
    availability: { minDuration: 2, unavailableDates: [{ date: "2030-01-01", type: "MANUAL", bookingId: "b", clientName: "Guest", clientPhone: "123", clientEmail: "guest@example.test", totalPrice: 100 }], unavailableSlots: [] } };
  const result = publicVenue(venue);
  assert.deepEqual(result.availability.unavailableDates, [{ date: "2030-01-01", type: "BLOCKED" }]);
  for (const field of ["staff", "coOrganisers", "moderation", "performance"]) assert.equal(result[field], undefined);
  assert.equal(result.createdBy.email, undefined);
  assert.equal(venue.availability.unavailableDates[0].clientName, "Guest");
  assert.equal(await canReadPrivateVenue(venue, null), false);
  assert.equal(await canReadPrivateVenue(venue, { id: "o" }), true);
});
test("refund completion requires processed status and exact money", () => {
  const booking = { refund: { amountMinor: 10000 }, totalPrice: { currency: "NGN" } };
  assert.equal(refundOutcome({ amount: 10000, currency: "NGN", status: "pending" }, booking), "PENDING");
  assert.equal(refundOutcome({ amount: 10000, currency: "NGN", status: "processed" }, booking), "PROCESSED");
  assert.equal(refundOutcome({ amount: 100, currency: "NGN", status: "processed" }, booking), "NEEDS_ATTENTION");
  assert.equal(refundOutcome(undefined, booking), "NEEDS_ATTENTION");
});
test("generic profile cannot change password or email, and phone changes clear verification", async () => {
  const User = require("../models/client/user.schema");
  let saved = 0;
  const user = { email: "owner@example.test", phoneNumber: "123", isPhoneVerified: true, roles: ["user"], save: async function () { saved++; return this; } };
  mock.method(User, "findById", () => ({ exec: async () => user }));
  const app = express(); app.use(express.json());
  app.patch("/:id", (req, res, next) => { req.user = { id: "owner" }; next(); }, require("../controllers/client/userProfile.controller").updateUser);
  for (const body of [{ email: "other@example.test" }, { password: "x" }]) assert.equal((await request(app).patch("/owner").send(body)).status, 400);
  assert.equal(saved, 0);
  assert.equal((await request(app).patch("/owner").send({ phoneNumber: "456" })).status, 200);
  assert.equal(user.isPhoneVerified, false); assert.equal(user.phoneVerifiedAt, null);
});
test("manual-transfer buyer checkout is rejected before accessing the database", async () => {
  const app = express(); app.use(express.json());
  app.post("/", (req, res, next) => { req.user = { id: "buyer" }; next(); }, require("../controllers/client/eventCenterTicket.controller").createTicket);
  assert.equal((await request(app).post("/").send({ paymentMethod: "transfer" })).status, 400);
});
test("calendar-view permission cannot reschedule bookings", async () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const venueId = "507f1f77bcf86cd799439011";
  const sandbox = { exports: {}, console, require(name) {
    if (name.endsWith("eventCenterBooking.schema")) return { findById: async () => ({ eventCenter: venueId }) };
    if (name.endsWith("eventCenter.schema")) return { findById: async () => ({ _id: venueId, createdBy: "owner" }) };
    if (name.endsWith("coOrganiserInvitation.schema")) return { findOne: async query => query.permissions.$in.includes("VIEW_CALENDAR") ? {} : null };
    if (name.endsWith("staffInvitation.schema")) return { findOne: async () => null };
    if (name.endsWith("venueLifecycle.service")) throw new Error("Mutation must not be reached");
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/client/eventCenterBooking.controller"), "utf8"), sandbox);
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await sandbox.exports.rescheduleBooking({ params: { bookingId: "b" }, user: { id: "viewer" }, body: { newDates: [] } }, res);
  assert.equal(res.code, 403);
});
