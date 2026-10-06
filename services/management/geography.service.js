const Location = require("../../models/management/geographicLocation.schema");
const Settings = require("../../models/management/regionalSettings.schema");
const Platform = require("../../models/management/platformSettings.schema");
const EventSettings = require("../../models/management/eventSettings.schema");
const policy = require("./geographicPolicy");
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const validId = value => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
const SETTING_KEYS = ["supportEmail", "supportPhone", "defaultTimezone", "defaultCurrency", "onSiteTicketsEnabled", "maxTicketsPerOrder"];
async function locationsFor(staff, action = "records.read") {
  const locations = await Location.find({}).sort({ name: 1 }).lean();
  const inactive = new Set(locations.filter(l => !l.active).map(l => String(l._id)));
  return locations.filter(l => l.active && !l.ancestors.some(a => inactive.has(String(a))) && policy.can(staff, l, action));
}
async function locationFor(staff, id, action) {
  if (!validId(id)) fail(400, "Invalid location ID");
  const location = (await locationsFor(staff, action)).find(l => String(l._id) === id);
  if (!location) fail(404, "Location not found or not accessible");
  return location;
}
async function validateAccess(value) {
  if (!value || !["global", "scoped"].includes(value.mode) || !Array.isArray(value.grants) || value.grants.length > 100) fail(400, "Choose global access or up to 100 location assignments");
  if (value.mode === "global" && value.grants.length) fail(400, "Global access cannot have regional assignments");
  const grants = [];
  for (const grant of value.grants) {
    if (!validId(grant.location) || !Object.hasOwn(policy.ROLES, grant.role) || typeof grant.includeDescendants !== "boolean") fail(400, "Invalid geographic assignment");
    if (grant.expiresAt && (!Number.isFinite(Date.parse(grant.expiresAt)) || new Date(grant.expiresAt) <= new Date())) fail(400, "Assignment expiration must be a future date");
    const location = await Location.findById(grant.location).lean();
    if (!location || !location.active || await Location.exists({ _id: { $in: location.ancestors }, active: false })) fail(400, "Assignments require an active location");
    grants.push({ location: location._id, role: grant.role, includeDescendants: grant.includeDescendants, expiresAt: grant.expiresAt || null });
  }
  return { mode: value.mode, grants };
}
async function settingsFor(id) {
  let location = null;
  if (id !== "global") {
    if (!validId(String(id))) fail(400, "Invalid location ID");
    location = await Location.findById(id).lean();
    if (!location || !location.active || await Location.exists({ _id: { $in: location.ancestors }, active: false })) fail(404, "Location is inactive or missing");
  }
  const chain = ["global", ...(location ? [...location.ancestors.map(String), String(location._id)] : [])];
  const [rows, platform, event] = await Promise.all([
    Settings.find({ scope: { $in: chain } }).lean(), Platform.findOne({ key: "platform_settings" }).lean(), EventSettings.getSingleton(),
  ]);
  const defaults = { supportEmail: platform?.supportEmail || "support@munasabahub.com", supportPhone: platform?.supportPhone || "", defaultTimezone: event.general.defaultTimezone, defaultCurrency: event.general.defaultCurrency, onSiteTicketsEnabled: event.ticketing.onSiteTicketsEnabled, maxTicketsPerOrder: event.ticketing.maxTicketsPerOrder };
  const ordered = chain.map(scope => rows.find(r => r.scope === scope) || { scope, overrides: {}, locks: [], revision: 0 });
  return { ...policy.mergeSettings(defaults, ordered), inherited: policy.mergeSettings(defaults, ordered.slice(0, -1)), local: ordered.at(-1), chain };
}
function validateSettings(overrides, locks) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || !Array.isArray(locks)) fail(400, "Settings must contain overrides and locks");
  if (Object.keys(overrides).some(k => !SETTING_KEYS.includes(k)) || locks.some(k => !SETTING_KEYS.includes(k))) fail(400, "Unknown regional setting");
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "onSiteTicketsEnabled") { if (typeof value !== "boolean") fail(400, "On-site ticket availability must be a boolean"); }
    else if (key === "maxTicketsPerOrder") { if (!Number.isInteger(value) || value < 1 || value > 1000) fail(400, "Ticket order limit must be between 1 and 1000"); }
    else {
      if (typeof value !== "string" || value.length > 200) fail(400, "Setting must be a string of at most 200 characters");
      if (key === "supportEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400, "Enter a valid support email");
      if (key === "defaultCurrency" && !/^[A-Z]{3}$/.test(value)) fail(400, "Use a three-letter uppercase currency code");
      if (key === "defaultTimezone") { if (!value.trim()) fail(400, "Timezone is required"); try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); } catch { fail(400, "Enter a valid timezone"); } }
    }
  }
}
async function recordFilter(staff, selected, action = "records.read") {
  const allowed = await locationsFor(staff, action);
  let ids = allowed.map(l => l._id);
  if (selected) {
    if (!validId(selected) || !allowed.some(l => String(l._id) === selected)) fail(404, "Location not found or not accessible");
    ids = allowed.filter(l => String(l._id) === selected || l.ancestors.some(a => String(a) === selected)).map(l => l._id);
  } else if (policy.isGlobal(staff) && policy.can(staff, null, action)) return {};
  return { managementLocation: { $in: ids } };
}
module.exports = { ...policy, fail, validId, locationsFor, locationFor, validateAccess, settingsFor, validateSettings, recordFilter, SETTING_KEYS };
