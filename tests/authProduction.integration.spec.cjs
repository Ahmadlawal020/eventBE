process.env.NODE_ENV = "test";
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
process.env.QR_SIGNING_SECRET = "test-only-qr-secret";
process.env.ACCESS_TOKEN_SECRET = "test-only-access-secret";
process.env.REFRESH_TOKEN_SECRET = "test-only-refresh-secret";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose"), express = require("express"), jwt = require("jsonwebtoken"), request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/client/user.schema");
const OTP = require("../models/client/otp.schema");
const Proof = require("../models/client/signupVerification.schema");
const Staff = require("../models/management/staff.schema");
const app = express(); app.use(express.json());
app.use("/api/auth", require("../routes/client/auth.route"));
app.use("/api/admin/auth", require("../routes/management/auth.route"));
app.use((error, req, res, next) => res.status(res.statusCode >= 400 ? res.statusCode : 500).json({ message: error.message }));
const payload = { firstName: "Test", surname: "Person", dob: "2000-01-01", password: "strong-test-password", authProvider: "local" };
test("signup proof and admin authorization are enforced by HTTP endpoints", { timeout: 120000 }, async t => {
  let db;
  try {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri(), { dbName: "isolated_auth_production" });
    await Promise.all([User.init(), OTP.init(), Proof.init(), Staff.init()]);
    await t.test("local signup without email proof is rejected", async () => {
      assert.equal((await request(app).post("/api/auth/signup").send({ ...payload, email: "missing@example.com" })).status, 400);
      assert.equal(await User.countDocuments(), 0);
    });
    let token;
    await t.test("OTP verification issues an email-bound expiring proof", async () => {
      await OTP.create({ identifier: "verified@example.com", type: "email", code: "123456", expiresAt: new Date(Date.now()+600000) });
      const response = await request(app).post("/api/auth/otp/verify").send({ identifier: "VERIFIED@example.com", type: "email", code: "123456" });
      assert.equal(response.status, 200); token = response.body.emailVerificationToken;
      assert.equal(typeof token, "string"); assert.equal(token.length, 64);
      assert.equal(await OTP.countDocuments(), 0);
      const mismatch = await request(app).post("/api/auth/signup").send({ ...payload, email: "wrong@example.com", emailVerificationToken: token });
      assert.equal(mismatch.status, 401); assert.equal(await Proof.countDocuments(), 1);
    });
    await t.test("signup consumes proof and cannot replay it after account removal", async () => {
      const signup = await request(app).post("/api/auth/signup").send({ ...payload, email: "verified@example.com", emailVerificationToken: token });
      assert.equal(signup.status, 201, JSON.stringify(signup.body));
      assert.equal(signup.body.data.user.isEmailVerified, true);
      assert.equal(jwt.verify(signup.body.data.accessToken, process.env.ACCESS_TOKEN_SECRET).accountType, "client");
      assert.equal(await Proof.countDocuments(), 0);
      await User.deleteOne({ email: "verified@example.com" });
      assert.equal((await request(app).post("/api/auth/signup").send({ ...payload, email: "verified@example.com", emailVerificationToken: token })).status, 401);
    });
    await t.test("empty staff database never exposes public bootstrap", async () => {
      const response = await request(app).post("/api/admin/auth/register").send({ firstName: "First", surname: "Admin", email: "admin@example.com", password: "long-password", roles: ["super_admin"] });
      assert.equal(response.status, 401); assert.equal(await Staff.countDocuments(), 0);
    });
    await t.test("revoked and client tokens cannot register administrators, even with shared IDs", async () => {
      const id = new mongoose.Types.ObjectId();
      await Staff.collection.insertOne({ _id: id, email: "owner@example.com", isActive: true, status: "active", accountStatus: "Active", roles: ["super_admin"], sessionVersion: 2 });
      for (const [accountType, sessionVersion] of [["management", 1], ["client", 2]]) {
        const accessToken = jwt.sign({ accountType, UserInfo: { id, sessionVersion } }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
        const response = await request(app).post("/api/admin/auth/register").set("Authorization", "Bearer " + accessToken).send({});
        assert.equal(response.status, 401);
      }
      assert.equal(await Staff.countDocuments(), 1);
    });
  } finally { await mongoose.disconnect(); if (db) await db.stop(); }
});
