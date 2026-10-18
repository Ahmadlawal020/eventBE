const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const mongoose = require("mongoose");
const Event = require("../models/client/event.schema");
const Settings = require("../models/management/eventSettings.schema");
const service = require("../services/eventSettings.service");
const policy = {
  platformPolicyAcknowledged: true, refundPolicyType: "REFUNDS_BEFORE_EVENT",
  refundWindowDays: 7, refundAmountType: "PARTIAL", partialRefundPercentage: 50,
  cancellationNotificationMethod: "Email", cancellationRefundProcess: "Contact organiser",
  cancellationRefundTimeline: "Within 7 days",
};
function harness({ owner = true, permissions = [], missing = false, status = "IN_PROGRESS", concurrentChange = false } = {}) {
  let writes = 0, realignments = 0;
  const saved = {
    _id: "507f1f77bcf86cd799439011", createdBy: "owner", status,
    schedule: { from: "2027-01-01", to: "2027-01-02" },
    ticketGuide: { description: "Entry instructions", includeFees: true, ...policy },
  };
  const context = { module: { exports: {} }, console, require(name) {
    if (name.endsWith("/event.schema")) return {
      findById: async () => missing ? null : { ...saved, toObject: () => saved },
      findOneAndUpdate: async (_filter, update, options) => {
        assert.equal(_filter.status, status);
        if (concurrentChange) return null;
        assert.equal(options.runValidators, true);
        const doc = new Event({ ticketGuide: update.ticketGuide });
        const error = doc.validateSync();
        // Validate the actual nested schema without requiring unrelated listing fields.
        const policyErrors = Object.entries(error?.errors || {}).filter(([key]) => key.startsWith("ticketGuide."));
        assert.deepEqual(policyErrors, []);
        writes++;
        return { ...saved, ...update, ticketGuide: doc.toObject().ticketGuide };
      },
    };
    if (name.endsWith("/listingPatch")) return require("../utils/listingPatch");
    if (name.endsWith("/eventSettings.service")) return { ...service, getEffectiveEventSettings: async () => new Settings().toObject() };
    if (name.endsWith("/ticketSalesWindow.service")) return { realignTicketSalesWindows: async () => { realignments++; return 0; } };
    if (name.endsWith("/coOrganiserInvitation.schema")) return { findOne: () => ({ lean: async () => ({ permissions }) }) };
    if (name === "mongoose") return mongoose;
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/client/event.controller"), "utf8"), context);
  return { writes: () => writes, realignments: () => realignments, async update(body, id = saved._id) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await context.module.exports.updateEvent({ params: { id }, user: { id: owner ? "owner" : "other" }, body }, res);
    return res;
  } };
}
test("policy updates preserve ticket guidance, trim terms, clear inactive fields, and do not reschedule tickets", async () => {
  const f = harness();
  const res = await f.update({ ticketGuide: { ...policy, refundPolicyType: "CUSTOM", customRefundTerms: "  Contact us first  " } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const saved = res.body.data.ticketGuide;
  assert.equal(saved.customRefundTerms, "Contact us first");
  assert.equal(saved.description, "Entry instructions");
  assert.equal(saved.includeFees, true);
  assert.equal(saved.refundWindowDays, null);
  assert.equal(saved.partialRefundPercentage, null);
  assert.equal(f.writes(), 1);
  assert.equal(f.realignments(), 0);
});
test("invalid refund values do not reach persistence", async () => {
  for (const patch of [{ refundWindowDays: 366 }, { partialRefundPercentage: 100 }, { cancellationNotificationMethod: {} }]) {
    const f = harness();
    assert.equal((await f.update({ ticketGuide: patch })).code, 400);
    assert.equal(f.writes(), 0);
  }
});
test("policy updates enforce owner or listing management permissions", async () => {
  const denied = harness({ owner: false });
  assert.equal((await denied.update({ ticketGuide: policy })).code, 403);
  assert.equal(denied.writes(), 0);
  const allowed = harness({ owner: false, permissions: ["MANAGE_LISTING"] });
  assert.equal((await allowed.update({ ticketGuide: policy })).code, 200);
});
test("invalid and missing event IDs are rejected", async () => {
  assert.equal((await harness().update({ ticketGuide: policy }, "invalid")).code, 400);
  assert.equal((await harness({ missing: true }).update({ ticketGuide: policy })).code, 404);
});
test("schedule edits still realign ticket windows", async () => {
  const f = harness();
  const res = await f.update({ schedule: { to: "2027-01-03" } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(f.realignments(), 1);
});

test("two-field policy patches persist trimmed terms and compatible ticket guidance", async () => {
  const res = await harness().update({
    cancellationRefundProcess: "  Send bank details  ",
    cancellationRefundTimeline: "  Within 7 days  ",
  });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const event = res.body.data;
  assert.equal(event.cancellationRefundProcess, "Send bank details");
  assert.equal(event.cancellationRefundTimeline, "Within 7 days");
  assert.equal(event.ticketGuide.cancellationRefundProcess, event.cancellationRefundProcess);
  assert.equal(event.ticketGuide.refundPolicyType, "NO_REFUNDS");
  assert.equal(event.ticketGuide.platformPolicyAcknowledged, true);
  assert.equal(event.ticketGuide.description, "Entry instructions");
});
test("two-field policy rejects invalid types and excessive lengths before saving", async () => {
  for (const value of [null, 123, {}, "x".repeat(1001)]) {
    const f = harness();
    assert.equal((await f.update({ cancellationRefundProcess: value })).code, 400);
    assert.equal(f.writes(), 0);
  }
});
test("two-field policy satisfies publishing terms and rejects blank live terms", () => {
  const settings = new Settings().toObject();
  const payload = service.normalizeEventCancellationPolicy({
    cancellationRefundProcess: "Send bank details",
    cancellationRefundTimeline: "Within 7 days",
  });
  const errors = service.validateEventPayload(payload, settings, { requireComplete: true });
  assert.equal(errors.some((error) => /refund|policy|notified/i.test(error)), false);
  const invalid = service.normalizeEventCancellationPolicy({
    cancellationRefundProcess: "   ",
  }, { ...payload, status: "LISTED" });
  const invalidErrors = service.validateEventPayload(
    { ...payload, ...invalid, status: "LISTED" }, settings,
    { existing: true, changes: invalid },
  );
  assert.ok(invalidErrors.some((error) => /refund/i.test(error)));
});
test("partial policy edits preserve the other field and legacy edits mirror top-level terms", () => {
  const previous = {
    cancellationRefundTimeline: "Within 7 days",
    ticketGuide: { description: "Entry instructions" },
  };
  const partial = service.normalizeEventCancellationPolicy({
    cancellationRefundProcess: "Send bank details",
  }, previous);
  assert.equal(partial.cancellationRefundTimeline, "Within 7 days");
  const legacy = service.normalizeEventCancellationPolicy({ ticketGuide: policy });
  assert.equal(legacy.cancellationRefundProcess, policy.cancellationRefundProcess);
  assert.equal(legacy.cancellationRefundTimeline, policy.cancellationRefundTimeline);
});

test("cancelled listings cannot be republished or changed by a stale editor",async()=>{
 assert.equal((await harness({status:"CANCELLED"}).update({status:"LISTED"})).code,409);
 assert.equal((await harness({status:"CANCELLED"}).update({status:"UNLISTED"})).code,409);
 assert.equal((await harness({status:"CANCELLED"}).update({isDraft:false})).code,409);
 assert.equal((await harness({concurrentChange:true}).update({title:"New title"})).code,409);
});
