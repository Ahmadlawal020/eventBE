const mongoose = require("mongoose");
const Policy = require("../models/management/referralPolicy.schema");
const Fees = require("../models/management/platformFees.schema");
const User = require("../models/client/user.schema");
const { addPeriod, resolvePolicy } = require("../utils/referralPolicy");
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const ensureGlobalPolicy = async () => {
  const existing = await Policy.findOne({ key: "GLOBAL" }).lean();
  if (existing) return existing;
  const fees = await Fees.findOne({ key: "platform_fees" }).lean();
  try {
    return await Policy.findOneAndUpdate({ key: "GLOBAL" }, { $setOnInsert: {
      key: "GLOBAL", scope: "GLOBAL", version: 1,
      revisions: [{ version: 1, effectiveAt: new Date(0), name: "All users",
        commissionPercentage: fees?.referralCommission ?? 5,
        duration: { value: fees?.referralDurationDays ?? 90, unit: "DAYS" },
        entryWindow: { value: 14, unit: "DAYS" },
        status: fees?.referralProgramEnabled === false ? "PAUSED" : "ACTIVE",
        userIds: [], priority: 0, reason: "Initial policy imported from platform settings" }],
    } }, { upsert: true, new: true }).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Policy.findOne({ key: "GLOBAL" }).lean();
  }
};
const getPolicies = async () => {
  await ensureGlobalPolicy();
  return Policy.find().lean();
};
const getEffectivePolicy = async (userId, at = new Date()) => resolvePolicy(await getPolicies(), userId, at);
const getEntryEligibility = async (user) => {
  const policy = await getEffectivePolicy(user._id);
  const window = policy.entryWindow;
  // Entry-window zero means registration only, unlike legacy unlimited earnings.
  const deadline = window.value === 0 ? new Date(user.createdAt) : addPeriod(user.createdAt, window);
  return { canApply: !user.referredBy && new Date() <= deadline, deadline, window };
};
const validatePeriod = (value, units, allowZero = false) => {
  if (!value || !Number.isInteger(value.value) || value.value < (allowZero ? 0 : 1) ||
      value.value > 3650 || !units.includes(value.unit)) fail("Invalid period");
  return { value: value.value, unit: value.unit };
};
const savePolicy = async (key, input, adminId) => {
  await ensureGlobalPolicy();
  const scope = key === "GLOBAL" ? "GLOBAL" : key.startsWith("USER:") ? "USER" : key.startsWith("GROUP:") ? "GROUP" : null;
  if (!scope || (scope !== "GLOBAL" && !mongoose.isValidObjectId(key.split(":")[1]))) fail("Invalid policy scope");
  const allowed = ["expectedVersion", "name", "userIds", "priority", "commissionPercentage", "duration", "entryWindow", "action", "reason"];
  if (Object.keys(input).some(k => !allowed.includes(k))) fail("Unknown policy setting");
  const existing = await Policy.findOne({ key }).lean();
  if (input.expectedVersion !== (existing?.version || 0)) fail("Settings changed. Refresh and try again.", 409);
  const previous = existing?.revisions.at(-1);
  const next = previous ? { ...previous } : {
    name: "", userIds: [], priority: 0, commissionPercentage: null, duration: null,
    entryWindow: null, status: "INHERIT", startedAt: null,
  };
  const now = new Date();
  next.version = (existing?.version || 0) + 1;
  next.effectiveAt = now;
  next.changedBy = adminId;
  next.reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if ("commissionPercentage" in input) {
    const rate = input.commissionPercentage;
    if (!(rate === null && scope !== "GLOBAL") && (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100)) fail("Commission must be 0-100");
    next.commissionPercentage = rate;
  }
  if ("duration" in input) next.duration = input.duration === null && scope !== "GLOBAL" ? null : validatePeriod(input.duration, ["DAYS","WEEKS","MONTHS"]);
  if ("entryWindow" in input) {
    if (scope !== "GLOBAL") fail("The code-entry window is a global setting");
    next.entryWindow = validatePeriod(input.entryWindow, ["DAYS","WEEKS"], true);
  }
  if ("name" in input) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100) fail("Name must be 1-100 characters");
    next.name = input.name.trim();
  }
  if (scope === "USER" && !await User.exists({ _id: key.split(":")[1] })) fail("User not found", 404);
  if ("userIds" in input) {
    if (scope !== "GROUP" || !Array.isArray(input.userIds) || input.userIds.length > 500 ||
        input.userIds.some(id => !mongoose.isValidObjectId(id))) fail("A group must contain valid users (maximum 500)");
    const ids = [...new Set(input.userIds.map(String))];
    if (await User.countDocuments({ _id: { $in: ids } }) !== ids.length) fail("One or more group users do not exist");
    next.userIds = ids;
  }
  if ("priority" in input) {
    if (scope !== "GROUP" || !Number.isInteger(input.priority) || input.priority < 0 || input.priority > 10000) fail("Invalid group priority");
    next.priority = input.priority;
  }
  if (input.action) {
    if (input.action === "START") { next.status = "ACTIVE"; next.startedAt = now; }
    else if (input.action === "PAUSE") { if (next.status === "ENDED") fail("Ended rewards must be started again"); next.status = "PAUSED"; }
    else if (input.action === "RESUME") { if (next.status !== "PAUSED") fail("Only paused rewards can resume"); next.status = "ACTIVE"; }
    else if (input.action === "END") next.status = "ENDED";
    else if (input.action === "INHERIT" && scope !== "GLOBAL") { next.status = "INHERIT"; next.startedAt = null; }
    else fail("Invalid referral action");
  }
  if (!existing) {
    try { return await Policy.create({ key, scope, targetUser: scope === "USER" ? key.split(":")[1] : null, version: 1, revisions: [next] }); }
    catch (error) { if (error.code === 11000) fail("Settings changed. Refresh and try again.", 409); throw error; }
  }
  const saved = await Policy.findOneAndUpdate({ key, version: input.expectedVersion },
    { $push: { revisions: next }, $inc: { version: 1 } }, { new: true, runValidators: true });
  if (!saved) fail("Settings changed. Refresh and try again.", 409);
  return saved;
};
module.exports = { ensureGlobalPolicy, getPolicies, getEffectivePolicy, getEntryEligibility, savePolicy };
