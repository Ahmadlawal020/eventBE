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
