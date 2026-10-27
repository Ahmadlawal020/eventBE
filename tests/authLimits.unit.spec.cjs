process.env.NODE_ENV = "test";
process.env.QR_SIGNING_SECRET = "limits-test-secret";
const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express"), request = require("supertest");
const User = require("../models/client/user.schema");
const otpService = require("../services/otp.service");
const app = express(); app.use(express.json());
app.use("/api/auth", require("../routes/client/auth.route"));
app.use("/api/event-bookings", require("../routes/client/eventBooking.route"));
afterEach(() => mock.restoreAll());
test("login route stops repeated attempts before account lookup", async () => {
  let reads = 0;
  mock.method(User, "findOne", () => ({ exec: async () => { reads++; return null; } }));
  for (let n = 0; n < 10; n++) assert.equal((await request(app).post("/api/auth/login").send({ email: "test@example.com", password: "wrong" })).status, 401);
  assert.equal((await request(app).post("/api/auth/login").send({ email: "test@example.com", password: "wrong" })).status, 429);
  assert.equal(reads, 10);
});
test("OTP send limit is shared across generic and password recovery routes", async () => {
  let sent = 0; mock.method(otpService, "requestOTP", async () => { sent++; });
  for (let n = 0; n < 5; n++) assert.equal((await request(app).post("/api/auth/otp/request").send({ identifier: "test@example.com", type: "password_change" })).status, 200);
  assert.equal((await request(app).post("/api/auth/password/request").send({ email: "test@example.com" })).status, 429);
  assert.equal(sent, 5);
});
test("public quotes are rate limited without database access", async () => {
  for (let n = 0; n < 60; n++) assert.equal((await request(app).post("/api/event-bookings/quote").send({ items: [] })).status, 400);
  assert.equal((await request(app).post("/api/event-bookings/quote").send({ items: [] })).status, 429);
});
