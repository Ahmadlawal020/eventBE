const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
process.env.ACCESS_TOKEN_SECRET = "moderation-unit-secret";
const Event = require("../models/client/event.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const controller = require("../controllers/management/moderation.controller");
const protect = require("../middleware/protectModerationFields");
const { canViewListing } = require("../services/listingVisibility");
const app = express();
app.use(express.json());
app.use("/moderation", require("../routes/management/moderation.route"));
app.patch("/organiser", protect, (req, res) => res.json({ success: true }));
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
const id = new mongoose.Types.ObjectId();
const updatedAt = new Date("2026-09-10T10:00:00Z");
const token = role => jwt.sign({ UserInfo: { id: String(id), roles: [role] } }, process.env.ACCESS_TOKEN_SECRET);
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const req = (decision, reason = "") => ({ params: { type: "event", id: String(id) }, user: { id: String(id) }, body: { decision, reason, updatedAt: updatedAt.toISOString() } });
const item = { _id: id, status: "LISTED", updatedAt };
afterEach(() => mock.restoreAll());

test("moderator API rejects anonymous users and non-moderator staff", async () => {
  assert.equal((await request(app).get("/moderation")).status, 401);
  for (const role of ["user", "finance_admin", "support_admin"]) {
    assert.equal((await request(app).get("/moderation").set("Authorization", "Bearer " + token(role))).status, 403);
  }
  assert.equal((await request(app).get("/moderation?status=invalid").set("Authorization", "Bearer " + token("moderator"))).status, 400);
});

test("organiser payloads cannot change moderation or inject MongoDB operators", async () => {
  for (const body of [{ moderation: { status: "APPROVED" } }, { "moderation.status": "APPROVED" }, { $set: { status: "LISTED" } }]) {
    assert.equal((await request(app).patch("/organiser").send(body)).status, 400);
  }
  assert.equal((await request(app).patch("/organiser").send({ title: "Edited listing" })).status, 200);
});

test("removal validation rejects empty reasons, invalid decisions and missing concurrency tokens", async () => {
  for (const input of [req("CANCELLED", " "), req("UNLISTED"), req("INVALID"), req("UNLISTED", "x".repeat(2001)), { ...req("APPROVED"), body: { decision: "APPROVED" } }]) {
    const res = response();
    await controller.decide(input, res, error => { throw error; });
    assert.equal(res.statusCode, 400);
  }
});

test("cancelling writes visibility, decision and history in the same conditional update", async () => {
  mock.method(Event, "findOne", () => ({ lean: async () => item }));
  let written;
  mock.method(Event, "findOneAndUpdate", async (filter, update, options) => {
    written = { filter, update, options };
    return { _id: id, status: "UNLISTED" };
  });
  const res = response();
  await controller.decide(req("CANCELLED", " Misleading photos "), res, error => { throw error; });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(written.filter.updatedAt, updatedAt);
  assert.equal(written.update.$set.status, "UNLISTED");
  assert.equal(written.update.$set["moderation.status"], "CANCELLED");
  assert.equal(written.update.$push["moderation.history"].reason, "Misleading photos");
  assert.equal(written.update.$push["moderation.history"].reviewer, String(id));
  assert.equal(written.options.runValidators, true);
});

test("stale decisions return a conflict; missing submissions return not found", async () => {
  mock.method(Event, "findOne", () => ({ lean: async () => item }));
  mock.method(Event, "findOneAndUpdate", async () => null);
  const res = response();
  await controller.decide(req("APPROVED"), res, error => { throw error; });
  assert.equal(res.statusCode, 409);
  mock.restoreAll();
  mock.method(Event, "findOne", () => ({ lean: async () => null }));
  const missing = response();
  await controller.decide(req("APPROVED"), missing, error => { throw error; });
  assert.equal(missing.statusCode, 404);
});

test("ended events cannot be restored", async () => {
  for (const value of [{ ...item, status: "COMPLETED" }, { ...item, schedule: { to: new Date("2000-01-01") } }]) {
    mock.method(Event, "findOne", () => ({ lean: async () => value }));
    const res = response();
    await controller.decide(req("APPROVED"), res, error => { throw error; });
    assert.equal(res.statusCode, 409);
    mock.restoreAll();
  }
});

test("Mongoose query guards protect both listing models from republish and verification sync", async () => {
  for (const model of [Event, EventCenter]) {
    let filter;
    mock.method(model.collection, "findOneAndUpdate", async value => { filter = value; return null; });
    await model.findByIdAndUpdate(id, { status: "LISTED" }, { new: true });
    assert.deepEqual(filter["moderation.status"], { $nin: ["UNLISTED", "CANCELLED"] });
    await model.findByIdAndUpdate(id, { status: "IN_PROGRESS" });
    assert.deepEqual(filter["moderation.status"], { $nin: ["UNLISTED", "CANCELLED"] });
    mock.method(model.collection, "updateMany", async value => { filter = value; return { modifiedCount: 0 }; });
    await model.updateMany({ status: "ACTION_REQUIRED" }, { status: "LISTED" });
    assert.deepEqual(filter["moderation.status"], { $nin: ["UNLISTED", "CANCELLED"] });
    // The trusted decision endpoint is allowed to restore a blocked listing.
    await model.findByIdAndUpdate(id, { $set: { status: "LISTED", "moderation.status": "APPROVED" } });
    assert.equal(filter["moderation.status"], undefined);
    mock.restoreAll();
  }
});

test("document saves cannot bypass a moderator removal", async () => {
  for (const model of [Event, EventCenter]) {
    const document = new model({ status: "UNLISTED", createdBy: id, moderation: { status: "CANCELLED" } });
    document.status = "LISTED";
    await assert.rejects(document.validate(), /moderator must restore/);
  }
});

test("hidden listing details are visible only to organisers, their team and moderators", () => {
  const listing = { status: "UNLISTED", createdBy: { _id: id }, staff: [], coOrganisers: [] };
  assert.equal(canViewListing(listing), false);
  assert.equal(canViewListing(listing, { id: "someone-else", roles: ["user"] }), false);
  assert.equal(canViewListing(listing, { id: String(id), roles: ["user"] }), true);
  assert.equal(canViewListing(listing, { id: "moderator", roles: ["moderator"] }), true);
  assert.equal(canViewListing({ ...listing, status: "LISTED" }), true);
});

test("the mixed queue paginates globally and treats legacy listings as pending", async () => {
  const all = Array.from({ length: 45 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(), title: i % 2 ? "Event " + i : undefined,
    venueName: i % 2 ? undefined : "Center " + i, status: "LISTED",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
  })).reverse();
  for (const [model, rows] of [[Event, all.filter(row => row.title)], [EventCenter, all.filter(row => row.venueName)]]) {
    mock.method(model, "find", () => {
      let size;
      const chain = { select() { return this; }, populate() { return this; }, sort() { return this; },
        limit(value) { size = value; return this; }, lean: async () => rows.slice(0, size) };
      return chain;
    });
    mock.method(model, "countDocuments", async () => rows.length);
    mock.method(model, "aggregate", async () => [{ _id: "PENDING", count: rows.length }]);
  }
  const combined = [];
  for (const page of [1, 2, 3]) {
    const res = response();
    await controller.getQueue({ query: { page: String(page) } }, res, error => { throw error; });
    assert.equal(res.body.data.pagination.total, 45);
    assert.equal(res.body.data.counts.PENDING, 45);
    combined.push(...res.body.data.items);
  }
  assert.deepEqual(combined.map(row => String(row._id)), all.map(row => String(row._id)));
  assert.ok(combined.every(row => row.moderation.status === "PENDING"));
});

test("legacy directory status actions require moderator access and use the moderation decision writer", async () => {
  const legacy = express();
  legacy.use(express.json());
  legacy.use("/listings", require("../routes/management/listings.route"));
  legacy.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  assert.equal((await request(legacy).patch("/listings/event/" + id + "/status")
    .set("Authorization", "Bearer " + token("finance_admin")).send({ status: "LISTED" })).status, 403);
  mock.method(Event, "findById", async () => item);
  mock.method(Event, "findOne", () => ({ lean: async () => item }));
  let update;
  mock.method(Event, "findOneAndUpdate", async (filter, value) => { update = value; return { _id: id, status: "UNLISTED" }; });
  const result = await request(legacy).patch("/listings/event/" + id + "/status")
    .set("Authorization", "Bearer " + token("moderator")).send({ status: "UNLISTED", reason: "Needs corrections" });
  assert.equal(result.status, 200);
  assert.equal(update.$set["moderation.status"], "UNLISTED");
  assert.equal(update.$push["moderation.history"].reason, "Needs corrections");
});
