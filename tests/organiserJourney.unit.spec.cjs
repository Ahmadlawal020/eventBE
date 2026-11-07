const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const eventService = require("../services/eventSettings.service");
const venueService = require("../services/eventCenterSettings.service");

test("all event publication requires identity and payout setup", () => {
  const settings = { publishing: { requireIdentityVerification: true, requirePayoutAccount: false } };
  const owner = { isIdentityVerified: true, bankDetails: { accountNumber: "test", bankCode: "test" } };
  assert.equal(eventService.organiserMeetsPublishingRequirements(owner, settings, true), false);
  assert.equal(eventService.organiserMeetsPublishingRequirements(owner, settings, false), false);
  assert.equal(eventService.organiserMeetsPublishingRequirements({ ...owner, vendorAccountCode: "test" }, settings, true), true);
  assert.equal(eventService.organiserMeetsPublishingRequirements({}, settings, false), false);
});

function syncHarness({ fail = false, ready = true, listed = false } = {}) {
  const settings = new (require("../models/management/eventCenterSettings.schema"))().toObject();
  settings.publishing.autoPublishVerifiedOwners = true;
  settings.publishing.minimumImages = 0; settings.publishing.minimumSafetyItems = 0;
  const valid = { _id: "valid", updatedAt: new Date("2026-11-01"), status: listed ? "LISTED" : "ACTION_REQUIRED", bookingSettings: "INSTANT",
    venueName: "Hall", venueType: "BANQUET_HALL", shortDescription: "A venue", description: "A complete venue", supportedEvents: ["WEDDINGS"],
    capacity: { max: 100 }, images: [], safety: [], basePrice: { amount: 1000000, currency: "NGN", unit: "day" },
    location: { addressString: "Lagos", coordinates: { latitude: 6, longitude: 3 } } };
  assert.deepEqual(venueService.validateVenuePayload(valid, settings, { publishing: true, requireComplete: true }), []);
  const writes = [];
  const context = { module: { exports: {} }, console: { error() {} },
    User: { findById: async () => ({ isIdentityVerified: ready, vendorAccountCode: "test" }) },
    EventCenter: { find: () => ({ lean: async () => [valid, { ...valid, _id: "incomplete", venueName: "" }] }), updateOne: async (filter, update) => { if (fail) throw Error("Database unavailable"); writes.push({ filter, update }); } },
    getEventCenterSettings: async () => settings,
    ownerMeetsPublishingRequirements: venueService.ownerMeetsPublishingRequirements,
    payoutReadinessError: venueService.payoutReadinessError,
    validateVenuePayload: venueService.validateVenuePayload,
  };
  const source = fs.readFileSync(require.resolve("../controllers/client/eventCenter.controller"), "utf8");
  vm.runInNewContext(source.slice(source.indexOf("const syncUserEventCenters ="), source.indexOf("module.exports =")) + "module.exports = syncUserEventCenters;", context);
  return { writes, valid, run: options => context.module.exports("owner", options) };
}
test("venue automatic publishing revalidates content and checks the version it validated", async () => {
  const h = syncHarness(); await h.run();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].filter._id, "valid");
  assert.equal(h.writes[0].filter.status, "ACTION_REQUIRED");
  assert.equal(+h.writes[0].filter.updatedAt, +h.valid.updatedAt);
});
test("verification callers can detect an automatic publishing failure", async () => {
  await assert.rejects(syncHarness({ fail: true }).run({ throwOnError: true }), /Database unavailable/);
});

test("a listed venue becomes action-required when owner verification is missing", async () => {
  const h = syncHarness({ ready: false, listed: true }); await h.run();
  const change = h.writes.find(write => write.filter._id === "valid");
  assert.equal(change.filter.status, "LISTED");
  assert.equal(change.update.$set.status, "ACTION_REQUIRED");
  assert.equal(+change.filter.updatedAt, +h.valid.updatedAt);
});
