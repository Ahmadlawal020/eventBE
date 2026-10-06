const express = require("express");
const Location = require("../../models/management/geographicLocation.schema");
const Settings = require("../../models/management/regionalSettings.schema");
const Event = require("../../models/client/event.schema");
const Venue = require("../../models/client/eventCenter.schema");
const { recordAdminAction } = require("../../services/management/adminAudit.service");
const geo = require("../../services/management/geography.service");
const router = express.Router();
const handle = fn => async (req, res) => { try { await fn(req, res); } catch (error) { const status = error.status || (error.code === 11000 ? 409 : error.name === "ValidationError" ? 400 : 500); res.status(status).json({ success: false, message: status === 500 ? "Unable to complete geographic management request" : error.code === 11000 ? "Code already exists or settings changed; reload and retry" : error.message }); } };
const owner = req => { if (!geo.isOwner(req.managementStaff)) geo.fail(403, "Global administrator access required"); };
const audit = (req, action, previousValue, newValue, targetId) => recordAdminAction({ req, action, targetType: "System", targetId, previousValue, newValue });
const models = { event: Event, venue: Venue };
const modelFor = type => { if (!Object.hasOwn(models, type)) geo.fail(400, "Invalid record type"); return models[type]; };
router.get("/context", handle(async (req, res) => {
  const staff = req.managementStaff;
  const locations = await geo.locationsFor(staff);
  res.json({ success: true, data: { access: geo.accessFor(staff), global: geo.isGlobal(staff), owner: geo.isOwner(staff), locations: locations.map(l => ({ ...l, canEditSettings: geo.can(staff, l, "settings.write"), canUnlist: geo.can(staff, l, "records.unlist") })), rolePermissions: geo.ROLES } });
}));
router.get("/locations", handle(async (req, res) => {
  const locations = geo.isOwner(req.managementStaff) ? await Location.find({}).sort({ name: 1 }).lean() : await geo.locationsFor(req.managementStaff);
  res.json({ success: true, data: locations });
}));
router.post("/locations", handle(async (req, res) => {
  owner(req);
  const { name, code, kind, parent } = req.body;
  if (typeof name !== "string" || !name.trim() || typeof code !== "string" || !/^[a-z0-9_-]{2,40}$/i.test(code)) geo.fail(400, "Provide a name and unique code (letters, digits, hyphens or underscores)");
  let ancestor = null;
  if (parent) ancestor = await geo.locationFor(req.managementStaff, parent, "settings.write");
  if (kind === "continent" && parent) geo.fail(400, "Continents have no parent");
  if (!["continent", "country"].includes(kind) && !parent) geo.fail(400, "This location type requires a parent location");
  if (ancestor && ancestor.ancestors.length >= 10) geo.fail(400, "Location hierarchy cannot exceed 12 levels");
  const location = await Location.create({ name, code, kind, parent: ancestor?._id || null, ancestors: ancestor ? [...ancestor.ancestors, ancestor._id] : [] });
  await audit(req, "LOCATION_CREATED", null, location.toObject(), location._id);
  res.status(201).json({ success: true, data: location });
}));
router.patch("/locations/:id", handle(async (req, res) => {
  owner(req);
  if (!geo.validId(req.params.id)) geo.fail(400, "Invalid location ID");
  if (Object.keys(req.body).some(k => !["name", "active"].includes(k))) geo.fail(400, "Only name and active status can change; hierarchy is immutable");
  if (req.body.active !== undefined && typeof req.body.active !== "boolean") geo.fail(400, "Active must be a boolean");
  const before = await Location.findById(req.params.id).lean();
  if (!before) geo.fail(404, "Location not found");
  const location = await Location.findByIdAndUpdate(before._id, { $set: req.body }, { new: true, runValidators: true });
  await audit(req, "LOCATION_UPDATED", before, location.toObject(), location._id);
  res.json({ success: true, data: location });
}));
router.get("/settings/:scope", handle(async (req, res) => {
  if (req.params.scope === "global") owner(req); else await geo.locationFor(req.managementStaff, req.params.scope, "settings.read");
  res.json({ success: true, data: await geo.settingsFor(req.params.scope) });
}));
router.put("/settings/:scope", handle(async (req, res) => {
  const scope = req.params.scope;
  if (scope === "global") owner(req); else await geo.locationFor(req.managementStaff, scope, "settings.write");
  const { overrides, locks, revision } = req.body;
  geo.validateSettings(overrides, locks);
  if (!Number.isInteger(revision) || revision < 0) geo.fail(400, "Settings revision is required");
  const before = await geo.settingsFor(scope);
  if (revision !== before.local.revision) geo.fail(409, "Settings changed; reload before saving");
  for (const key of [...Object.keys(overrides), ...locks]) if (before.inherited.lockedBy[key]) geo.fail(403, "A parent location has locked " + key);
  const updated = await Settings.findOneAndUpdate({ scope, revision }, { $set: { overrides, locks: [...new Set(locks)] }, $inc: { revision: 1 } }, { new: true, upsert: revision === 0, runValidators: true });
  if (!updated) geo.fail(409, "Settings changed; reload before saving");
  await audit(req, "REGIONAL_SETTINGS_UPDATED", before.local, updated.toObject(), updated._id);
  res.json({ success: true, data: await geo.settingsFor(scope) });
}));
router.get("/records", handle(async (req, res) => {
  const model = modelFor(req.query.type || "event");
  const filter = await geo.recordFilter(req.managementStaff, req.query.location);
  if (req.query.unassigned === "true") { owner(req); filter.managementLocation = null; }
  if (req.query.search) { if (typeof req.query.search !== "string" || req.query.search.length > 150) geo.fail(400, "Search is too long"); const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); filter[model === Event ? "title" : "venueName"] = new RegExp(escaped, "i"); }
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const limit = 20;
  const [items, total] = await Promise.all([
    model.find(filter).select("title venueName status managementLocation location.city location.country location.addressString schedule createdAt updatedAt").sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), model.countDocuments(filter),
  ]);
  res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
}));
router.patch("/records/:type/:id/location", handle(async (req, res) => {
  owner(req);
  const model = modelFor(req.params.type);
  if (!geo.validId(req.params.id)) geo.fail(400, "Invalid record ID");
  if (req.body.location !== null && !geo.validId(req.body.location)) geo.fail(400, "Select a location or explicitly clear the assignment");
  const location = req.body.location ? await geo.locationFor(req.managementStaff, req.body.location, "settings.write") : null;
  if (!req.body.updatedAt || !Number.isFinite(Date.parse(req.body.updatedAt))) geo.fail(400, "Record revision is required");
  const before = await model.findOneAndUpdate({ _id: req.params.id, updatedAt: new Date(req.body.updatedAt) }, { $set: { managementLocation: location?._id || null } }, { new: false });
  if (!before) geo.fail(409, "Record changed or no longer exists; reload before assigning");
  await audit(req, "RECORD_LOCATION_ASSIGNED", { location: before.managementLocation }, { location: location?._id || null, type: req.params.type }, before._id);
  res.json({ success: true });
}));
router.post("/records/:type/:id/unlist", handle(async (req, res) => {
  const model = modelFor(req.params.type);
  if (!geo.validId(req.params.id)) geo.fail(400, "Invalid record ID");
  const filter = await geo.recordFilter(req.managementStaff, undefined, "records.unlist");
  if (typeof req.body.reason !== "string" || !req.body.reason.trim() || req.body.reason.length > 2000) geo.fail(400, "A reason of up to 2000 characters is required");
  if (!req.body.updatedAt || !Number.isFinite(Date.parse(req.body.updatedAt))) geo.fail(400, "Record revision is required");
  const before = await model.findOneAndUpdate({ $and: [filter, { _id: req.params.id, updatedAt: new Date(req.body.updatedAt), status: "LISTED" }] }, { $set: { status: "UNLISTED", "moderation.status": "UNLISTED", "moderation.reason": req.body.reason.trim(), "moderation.reviewedAt": new Date(), "moderation.reviewedBy": req.managementStaff._id }, $push: { "moderation.history": { decision: "UNLISTED", reason: req.body.reason.trim(), previousStatus: "LISTED", listingStatus: "UNLISTED", reviewer: req.managementStaff._id } } }, { new: false, runValidators: true });
  if (!before) geo.fail(404, "Listing is inaccessible, changed or is no longer listed");
  await audit(req, "REGIONAL_LISTING_UNLISTED", { status: before.status }, { status: "UNLISTED", reason: req.body.reason, type: req.params.type, location: before.managementLocation }, before._id);
  res.json({ success: true });
}));
module.exports = router;
