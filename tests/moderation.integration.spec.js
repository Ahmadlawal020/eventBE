const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
process.env.ACCESS_TOKEN_SECRET = "moderation-isolated-test-secret";
const Event = require("../models/client/event.schema");
const EventCenter = require("../models/client/eventCenter.schema");
require("../models/client/user.schema");
const protectFields = require("../middleware/protectModerationFields");
const app = express();
app.use(express.json());
app.use("/moderation", require("../routes/management/moderation.route"));
app.patch("/organiser", protectFields, (req, res) => res.json({ success: true }));
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
const owner = new mongoose.Types.ObjectId();
const token = roles => jwt.sign({ UserInfo: { id: String(owner), roles } }, process.env.ACCESS_TOKEN_SECRET);
const moderator = token(["moderator"]);
const get = path => request(app).get(path).set("Authorization", "Bearer " + moderator);
const decide = (type, item, decision, reason = "") => request(app)
  .patch("/moderation/" + type + "/" + item._id).set("Authorization", "Bearer " + moderator)
  .send({ decision, reason, updatedAt: item.updatedAt.toISOString() });
let mongo;
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "moderation_isolated" });
});
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
beforeEach(async () => { await Promise.all([Event.deleteMany({}), EventCenter.deleteMany({})]); });

test("submitted events and centers enter the queue; drafts are excluded and legacy listings are pending", async () => {
  await Event.create({ title: "Published event", status: "LISTED", createdBy: owner });
  await Event.create({ title: "Draft", status: "IN_PROGRESS", createdBy: owner });
  await EventCenter.create({ venueName: "Submitted center", status: "ACTION_REQUIRED", createdBy: owner });
  await Event.collection.insertOne({ title: "Legacy", status: "LISTED", createdBy: owner, createdAt: new Date(), updatedAt: new Date() });
  const result = await get("/moderation");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.pagination.total, 3);
  assert.equal(result.body.data.counts.PENDING, 3);
  assert.ok(result.body.data.items.every(item => item.moderation.status === "PENDING"));
});

test("mixed queue pagination sorts globally without missing or repeating rows", async () => {
  for (let i = 0; i < 45; i++) {
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, i));
    if (i % 2) await Event.create({ title: "Event " + i, status: "LISTED", createdBy: owner, createdAt });
    else await EventCenter.create({ venueName: "Center " + i, status: "LISTED", createdBy: owner, createdAt });
  }
  const pages = await Promise.all([1, 2, 3].map(page => get("/moderation?page=" + page)));
  const items = pages.flatMap(page => page.body.data.items);
  assert.equal(items.length, 45);
  assert.equal(new Set(items.map(item => item._id)).size, 45);
  assert.ok(items.every((item, i) => !i || new Date(items[i - 1].createdAt) >= new Date(item.createdAt)));
  const literal = await get("/moderation?search=" + encodeURIComponent(".*"));
  assert.equal(literal.body.data.pagination.total, 0);
});

test("decisions persist with atomic history; stale decisions fail and moderators can restore listings", async () => {
  for (const [type, model] of [["event", Event], ["event-center", EventCenter]]) {
    const item = await model.create({ title: "Event", venueName: "Center", createdBy: owner, status: "LISTED" });
    const cancelled = await decide(type, item, "CANCELLED", "Misleading listing");
    assert.equal(cancelled.status, 200);
    const saved = await model.findById(item._id).select("+moderation.history");
    assert.equal(saved.status, "UNLISTED");
    assert.equal(saved.moderation.status, "CANCELLED");
    assert.equal(saved.moderation.history.length, 1);
    assert.equal(String(saved.moderation.history[0].reviewer), String(owner));
    assert.equal((await decide(type, item, "APPROVED")).status, 409);
    assert.equal((await decide(type, saved, "APPROVED", "Corrected and reviewed")).status, 200);
    const restored = await model.findById(item._id).select("+moderation.history");
    assert.equal(restored.status, "LISTED");
    assert.equal(restored.moderation.history.length, 2);
    const detail = await get("/moderation/" + type + "/" + item._id);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.moderation.history.length, 2);
  }
});

test("unlisted and cancelled listings cannot be republished by organiser updates or verification sync", async () => {
  for (const model of [Event, EventCenter]) {
    const item = await model.create({ createdBy: owner, status: "UNLISTED", moderation: { status: "CANCELLED" } });
    assert.equal(await model.findByIdAndUpdate(item._id, { status: "LISTED" }, { new: true }), null);
    const sync = await model.updateMany({ _id: item._id }, { status: "LISTED" });
    assert.equal(sync.modifiedCount, 0);
    assert.equal(await model.findByIdAndUpdate(item._id, { status: "IN_PROGRESS" }), null);
    item.status = "LISTED";
    await assert.rejects(item.save(), /moderator must restore/);
  }
});

test("removal requires a reason, invalid identities are rejected, and drafts or ended events cannot be approved", async () => {
  const item = await Event.create({ title: "Event", createdBy: owner, status: "LISTED" });
  assert.equal((await decide("event", item, "UNLISTED", " ")).status, 400);
  assert.equal((await get("/moderation/event/not-an-id")).status, 400);
  assert.equal((await get("/moderation/constructor/" + item._id)).status, 400);
  assert.equal((await get("/moderation?status=invalid")).status, 400);
  assert.equal((await decide("event", item, "UNLISTED", "Needs corrections")).status, 200);
  const draft = await Event.create({ title: "Draft", createdBy: owner });
  assert.equal((await decide("event", draft, "APPROVED")).status, 404);
  const ended = await Event.create({ title: "Ended", createdBy: owner, status: "COMPLETED" });
  assert.equal((await decide("event", ended, "APPROVED")).status, 409);
});

test("moderation requires a moderator role and organiser requests cannot write protected fields", async () => {
  assert.equal((await request(app).get("/moderation")).status, 401);
  for (const role of ["user", "finance_admin", "support_admin"]) {
    assert.equal((await request(app).get("/moderation").set("Authorization", "Bearer " + token([role]))).status, 403);
  }
  for (const body of [{ moderation: { status: "APPROVED" } }, { "moderation.status": "APPROVED" }, { $set: { status: "LISTED" } }]) {
    assert.equal((await request(app).patch("/organiser").send(body)).status, 400);
  }
  assert.equal((await request(app).patch("/organiser").send({ title: "Edited title" })).status, 200);
});
