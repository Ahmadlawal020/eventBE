const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const Settings = require("../models/management/eventSettings.schema");
const service = require("../services/eventSettings.service");
function fixture() {
  const settings = new Settings(); let saves = 0, audits = 0;
  settings.save = async () => { await settings.validate(); saves++; return settings; };
  const sandbox = { module: { exports: {} }, Intl, console: { error() {} }, require(id) {
    if (id.endsWith("/eventSettings.service")) return { ...service, getEventSettings: async () => settings };
    if (id.endsWith("/adminAudit.service")) return { recordAdminAction: async () => { audits++; } };
    return Settings;
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/management/eventSettings.controller"), "utf8"), sandbox);
  return { settings, saves: () => saves, audits: () => audits, async update(body) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await sandbox.module.exports.updateAdminEventSettings({ body }, res); return res;
  } };
}
test("partial settings saves preserve other fields and record an audit", async () => {
  const f = fixture(); const res = await f.update({ general: { defaultCurrency: "USD" } });
  assert.equal(res.code, 200); assert.equal(f.settings.general.defaultCurrency, "USD");
  assert.equal(f.settings.general.defaultTimezone, "Africa/Lagos"); assert.equal(f.saves(), 1); assert.equal(f.audits(), 1);
});
test("per-currency updates preserve other currency floors", async () => {
  const f = fixture(); f.settings.pricing.minimumBasePrices.NGN = 500;
  assert.equal((await f.update({ pricing: { minimumBasePrices: { USD: 5 } } })).code, 200);
  assert.equal(f.settings.pricing.minimumBasePrices.NGN, 500); assert.equal(f.settings.pricing.minimumBasePrices.USD, 5);
});
test("invalid regional defaults are rejected without saving", async () => {
  for (const general of [{ defaultTimezone: "not/a-zone" }, { defaultCurrency: "BAD" }]) {
    const f = fixture(); assert.equal((await f.update({ general })).code, 400); assert.equal(f.saves(), 0);
  }
});
test("zero images are allowed when cover and minimum requirements are disabled", async () => {
  const f = fixture(); const res = await f.update({ publishing: { requireCoverImage: false, minimumImages: 0 } });
  assert.equal(res.code, 200); assert.equal(f.settings.contentLimits.minImages, 0);
  assert.deepEqual(service.validateEventPayload({}, f.settings, { publishing: true, requireComplete: false, existing: true }), []);
});
test("inconsistent image limits are rejected using all image requirements", async () => {
  const f = fixture(); assert.equal((await f.update({ publishing: { minimumImages: 4 }, contentLimits: { minImages: 1, maxImages: 2 } })).code, 400);
  assert.equal(f.saves(), 0);
});
test("legacy disabled-draft flags no longer block creating drafts", () => {
  const settings = new Settings().toObject(); settings.general.draftsEnabled = false;
  assert.deepEqual(service.validateEventPayload({ isDraft: true }, settings), []);
  assert.equal(service.publicEventSettings(settings).general.draftsEnabled, undefined);
  settings.general.eventCreationEnabled = false;
  assert.ok(service.validateEventPayload({ isDraft: true }, settings).includes("Event creation is temporarily disabled"));
});
test("event timezone defaults persist and explicit timezones are retained", () => {
  const settings = new Settings(); settings.general.defaultTimezone = "Europe/London";
  assert.equal(service.applyGuidanceDefaults({}, settings).schedule.timeZone, "Europe/London");
  assert.equal(service.applyGuidanceDefaults({ schedule: { timeZone: "Africa/Lagos" } }, settings).schedule.timeZone, "Africa/Lagos");
});
test("publishing requires the complete organiser terms and policy configuration", () => {
  const settings = new Settings().toObject();
  const base = {
    title: "A title",
    eventType: "COMMUNITY_LOCAL",
    shortDescription: "A short description",
    description: "A description",
    schedule: { from: "2027-01-01T10:00:00.000Z", to: "2027-01-01T12:00:00.000Z" },
    location: { addressString: "1 Test Street", street: "Test Street", city: "Lagos", country: "Nigeria", coordinates: { latitude: 6.5, longitude: 3.4 } },
    ticketGuide: {
      platformPolicyAcknowledged: true,
      refundPolicyType: "REFUNDS_BEFORE_EVENT",
      refundWindowDays: 7,
      refundAmountType: "PARTIAL",
      partialRefundPercentage: 50,
      cancellationNotificationMethod: "Email and in-app notification",
      cancellationRefundProcess: "We will contact eligible ticket holders and issue refunds directly.",
      cancellationRefundTimeline: "Within 5 to 7 business days.",
    },
  };
  settings.publishing.requireCoverImage = false;
  settings.publishing.minimumImages = 0;
  settings.contentLimits.minImages = 0;
  settings.publishing.minLeadTimeHours = 0;
  assert.deepEqual(service.validateEventPayload(base, settings, { publishing: true }), []);
  assert.ok(service.validateEventPayload({ ...base, ticketGuide: { ...base.ticketGuide, platformPolicyAcknowledged: false } }, settings, { publishing: true }).some((error) => error.includes("Acknowledge")));
  assert.ok(service.validateEventPayload({ ...base, ticketGuide: { ...base.ticketGuide, refundAmountType: undefined } }, settings, { publishing: true }).some((error) => error.includes("full or partial")));
  assert.ok(service.validateEventPayload({ ...base, ticketGuide: { ...base.ticketGuide, refundPolicyType: "CUSTOM", customRefundTerms: "" } }, settings, { publishing: true }).some((error) => error.includes("custom refund terms")));
});
test("terms are validated when a non-draft listing receives a ticketGuide patch", () => {
  const settings = new Settings().toObject();
  const cleared = {
    status: "LISTED",
    ticketGuide: {
      platformPolicyAcknowledged: false,
      refundPolicyType: null,
      refundWindowDays: null,
      refundAmountType: null,
      partialRefundPercentage: null,
      customRefundTerms: null,
      cancellationNotificationMethod: "",
      cancellationRefundProcess: "",
      cancellationRefundTimeline: "",
    },
  };
  const errors = service.validateEventPayload(cleared, settings, {
    existing: true,
    changes: cleared,
    publishing: false,
  });
  assert.ok(errors.some((error) => error.includes("Acknowledge")));
  assert.ok(errors.some((error) => error.includes("attendee refund policy")));
  assert.ok(errors.some((error) => error.includes("cancellation")));
  // Drafts stay freely editable so the multi-stage wizard can save partial terms.
  const draftPatch = { ...cleared, status: "IN_PROGRESS" };
  assert.deepEqual(service.validateEventPayload(draftPatch, settings, {
    existing: true,
    changes: draftPatch,
    publishing: false,
  }), []);
  // Patches that do not touch ticketGuide are unaffected.
  const titlePatch = { status: "LISTED", title: "A new title" };
  assert.deepEqual(service.validateEventPayload(titlePatch, settings, {
    existing: true,
    changes: titlePatch,
    publishing: false,
  }), []);
});
test("refund window is capped at 365 days", () => {
  const settings = new Settings().toObject();
  const patch = {
    status: "LISTED",
    ticketGuide: {
      platformPolicyAcknowledged: true,
      refundPolicyType: "REFUNDS_BEFORE_EVENT",
      refundWindowDays: 400,
      refundAmountType: "FULL",
      cancellationNotificationMethod: "Email",
      cancellationRefundProcess: "Direct refunds.",
      cancellationRefundTimeline: "5 to 7 business days.",
    },
  };
  const errors = service.validateEventPayload(patch, settings, {
    existing: true,
    changes: patch,
    publishing: false,
  });
  assert.ok(errors.some((error) => error.includes("365")));
  patch.ticketGuide.refundWindowDays = 365;
  assert.deepEqual(service.validateEventPayload(patch, settings, {
    existing: true,
    changes: patch,
    publishing: false,
  }), []);
});
test("normalizeTicketGuide clears fields that do not belong to the policy type", () => {
  const base = {
    refundWindowDays: 7,
    refundAmountType: "PARTIAL",
    partialRefundPercentage: 50,
    customRefundTerms: "custom",
  };
  const noRefunds = service.normalizeTicketGuide({ ...base, refundPolicyType: "NO_REFUNDS" });
  assert.equal(noRefunds.refundWindowDays, null);
  assert.equal(noRefunds.refundAmountType, null);
  assert.equal(noRefunds.partialRefundPercentage, null);
  assert.equal(noRefunds.customRefundTerms, null);

  const custom = service.normalizeTicketGuide({ ...base, refundPolicyType: "CUSTOM" });
  assert.equal(custom.refundWindowDays, null);
  assert.equal(custom.refundAmountType, null);
  assert.equal(custom.partialRefundPercentage, null);
  assert.equal(custom.customRefundTerms, "custom");

  const full = service.normalizeTicketGuide({ ...base, refundPolicyType: "REFUNDS_BEFORE_EVENT", refundAmountType: "FULL" });
  assert.equal(full.customRefundTerms, null);
  assert.equal(full.partialRefundPercentage, null);
  assert.equal(full.refundWindowDays, 7);

  const partial = service.normalizeTicketGuide({ ...base, refundPolicyType: "REFUNDS_BEFORE_EVENT", refundAmountType: "PARTIAL" });
  assert.equal(partial.customRefundTerms, null);
  assert.equal(partial.partialRefundPercentage, 50);
});


test("refund policy rejects malformed values and enforces database limits", () => {
  const settings = new Settings().toObject();
  const valid = {
    platformPolicyAcknowledged: true,
    refundPolicyType: "REFUNDS_BEFORE_EVENT",
    refundWindowDays: 7,
    refundAmountType: "PARTIAL",
    partialRefundPercentage: 50,
    cancellationNotificationMethod: "Email",
    cancellationRefundProcess: "Organiser transfers the ticket price.",
    cancellationRefundTimeline: "Within seven days.",
  };
  const validate = (ticketGuide, status = "LISTED") =>
    service.validateEventPayload({ status, ticketGuide }, settings, {
      existing: true, changes: { ticketGuide },
    });
  for (const percentage of [1, 50.5, 99]) {
    assert.deepEqual(validate({ ...valid, partialRefundPercentage: percentage }), []);
  }
  for (const patch of [
    { refundPolicyType: "UNKNOWN" }, { refundAmountType: "UNKNOWN" },
    { platformPolicyAcknowledged: "true" }, { refundWindowDays: 1.5 },
    { partialRefundPercentage: 0.5 }, { partialRefundPercentage: 99.5 },
    { cancellationNotificationMethod: {} }, { cancellationRefundProcess: 4 },
    { cancellationRefundTimeline: [] }, { cancellationRefundTimeline: "x".repeat(501) },
    { refundPolicyType: "CUSTOM", customRefundTerms: {} },
    { refundPolicyType: "CUSTOM", customRefundTerms: "x".repeat(1001) },
  ]) {
    assert.ok(validate({ ...valid, ...patch }).length, JSON.stringify(patch));
  }
  for (const malformed of [null, [], "policy"]) {
    assert.ok(validate(malformed).length);
  }
  assert.deepEqual(validate({}, "IN_PROGRESS"), []);
  assert.ok(validate({ refundWindowDays: 1.5 }, "IN_PROGRESS").length);
  assert.ok(validate(undefined).length, "Admin approval cannot skip a missing policy");
});

test("policy patches preserve ticket guide fields and clear contradictory refund fields", () => {
  const { prepareListingPatch, EVENT_FIELDS } = require("../utils/listingPatch");
  const previous = { ticketGuide: {
    description: "Bring your ticket", includeFees: true,
    refundPolicyType: "REFUNDS_BEFORE_EVENT", refundWindowDays: 7,
    refundAmountType: "PARTIAL", partialRefundPercentage: 50,
  } };
  const patch = prepareListingPatch({ ticketGuide: { refundPolicyType: "NO_REFUNDS" } }, EVENT_FIELDS, previous);
  const guide = service.normalizeTicketGuide(patch.ticketGuide);
  assert.equal(guide.description, "Bring your ticket");
  assert.equal(guide.includeFees, true);
  assert.equal(guide.refundWindowDays, null);
  assert.equal(guide.partialRefundPercentage, null);
  assert.equal(previous.ticketGuide.refundWindowDays, 7);
});

test("event schema rejects fractional refund windows", () => {
  const Event = require("../models/client/event.schema");
  const event = new Event({ ticketGuide: { refundWindowDays: 1.5 } });
  assert.ok(event.validateSync().errors["ticketGuide.refundWindowDays"]);
});
