process.env.NODE_ENV = "test";
process.env.QR_SIGNING_SECRET = "test-only-secret";
const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const User = require("../models/client/user.schema");
const Staff = require("../models/management/staff.schema");
afterEach(() => mock.restoreAll());
function appFor(handler, cookies) {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = { id: "owner" }; req.cookies = cookies; next(); });
  app.post("/", handler); app.delete("/:id", handler);
  app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
  return app;
}
for (const [kind, Model, handler] of [
  ["client", User, require("../controllers/client/auth.controller").handleLogout],
  ["admin", Staff, require("../controllers/management/auth.controller").handleAdminLogout],
]) {
  test(kind + " logout rejects malformed inputs before any database mutation", async () => {
    let writes = 0;
    mock.method(Model, "updateOne", async () => { writes++; });
    mock.method(Model, "findOne", () => { throw new Error("Unexpected account lookup"); });
    const app = appFor(handler);
    for (const refreshToken of [{ $ne: "" }, ["token"], 123, true, null, "", " ", "a".repeat(8193)]) {
      assert.equal((await request(app).post("/").send({ refreshToken })).status, 400);
    }
    assert.equal((await request(app).post("/").send({})).status, 204);
    assert.equal(writes, 0);
  });
  test(kind + " logout matches exactly one literal token atomically", async () => {
    const writes = [];
    mock.method(Model, "updateOne", async (...args) => writes.push(args));
    const app = appFor(handler);
    assert.equal((await request(app).post("/").send({ refreshToken: "literal-token", pushToken: "device" })).status, 200);
    assert.deepEqual(writes[0][0], { refreshToken: { $eq: "literal-token" } });
    assert.deepEqual(writes[0][1].$set, { refreshToken: "" });
    if (kind === "client") assert.deepEqual(writes[0][1].$pull, { pushTokens: { token: "device" } });
  });
}
test("admin logout uses the refresh cookie and clears it", async () => {
  let filter;
  mock.method(Staff, "updateOne", async value => { filter = value; });
  const response = await request(appFor(require("../controllers/management/auth.controller").handleAdminLogout,
    { munasaba_admin_refresh: "cookie-token" })).post("/").send({ refreshToken: { $ne: "" } });
  assert.equal(response.status, 200);
  assert.deepEqual(filter, { refreshToken: { $eq: "cookie-token" } });
  assert.match(response.headers["set-cookie"][0], /munasaba_admin_refresh=;/);
});
test("client logout rejects push-token operators", async () => {
  mock.method(User, "updateOne", () => { throw new Error("Unexpected write"); });
  assert.equal((await request(appFor(require("../controllers/client/auth.controller").handleLogout))
    .post("/").send({ refreshToken: "token", pushToken: { $ne: "" } })).status, 400);
});
test("account closure preserves the account and media, including concurrent obligations", async () => {
  mock.method(User, "findById", () => ({ exec: async () => ({ _id: "owner", profilePicture: { publicId: "retained" } }) }));
  mock.method(User, "findByIdAndDelete", () => { throw new Error("Must retain account"); });
  mock.method(require("../utils/cloudinary").uploader, "destroy", () => { throw new Error("Must retain media"); });
  const app = appFor(require("../controllers/client/userProfile.controller").deleteUserAccount);
  assert.equal((await request(app).delete("/someone-else")).status, 403);
  const response = await request(app).delete("/owner");
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "ACCOUNT_CLOSURE_REQUIRES_SUPPORT");
  mock.method(User, "findById", () => ({ exec: async () => null }));
  assert.equal((await request(app).delete("/owner")).status, 404);
});
