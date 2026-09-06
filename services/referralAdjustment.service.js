const Adjustment = require("../models/management/referralAdjustment.schema");
const Earning = require("../models/client/referralEarning.schema");
const Policy = require("../models/management/referralPolicy.schema");
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const summarize = (doc) => ({
  id: doc._id, scopeKey: doc.scopeKey, from: doc.from, to: doc.to, rate: doc.rate,
  reason: doc.reason, status: doc.status, count: doc.entries.length,
  previousTotal: Math.round(doc.entries.reduce((sum,e) => sum + e.oldAmount,0) * 100) / 100,
  revisedTotal: Math.round(doc.entries.reduce((sum,e) => sum + e.newAmount,0) * 100) / 100,
  expiresAt: doc.expiresAt, appliedCount: doc.appliedCount,
});
const previewAdjustment = async (input, adminId) => {
  const { scopeKey, from, to, rate, reason } = input;
  if (typeof scopeKey !== "string" || !/^(GLOBAL|(?:GROUP|USER):[a-fA-F0-9]{24})$/.test(scopeKey)) fail("Invalid policy scope");
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100) fail("Invalid rate");
  const start = new Date(from), end = new Date(to);
  if (!from || !to || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) fail("Invalid date range");
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500) fail("A reason is required (maximum 500 characters)");
  const policy = await Policy.findOne({ key: scopeKey }).lean();
  if (!policy) fail("Policy not found",404);
  const filter = { status: { $in: ["COMPLETED", "PENDING"] }, $expr: { $and: [
    { $gte: [{ $ifNull: ["$qualifiedAt", "$createdAt"] }, start] },
    { $lte: [{ $ifNull: ["$qualifiedAt", "$createdAt"] }, end] },
  ] } };
  if (policy.scope === "USER") filter.referrer = policy.targetUser;
  if (policy.scope === "GROUP") filter.referrer = { $in: policy.revisions.at(-1).userIds };
  const records = await Earning.find(filter).limit(1001).lean();
  if (records.length > 1000) fail("Select a smaller date range (maximum 1000 earnings per adjustment)");
  const entries = records.map(e => ({ earningId: e._id, oldRate: e.commissionPercentage,
    oldAmount: e.commissionAmount, newAmount: Math.round(e.totalAmount * rate) / 100, status: e.status }));
  return summarize(await Adjustment.create({ scopeKey, createdBy: adminId, from: start, to: end,
    rate, reason: reason.trim(), expiresAt: new Date(Date.now() + 30 * 60000), entries }));
};
const applyAdjustment = async (id, adminId, confirm) => {
  if (confirm !== true) fail("Explicit confirmation is required");
  const preview = await Adjustment.findById(id);
  if (!preview) fail("Adjustment not found",404);
  if (String(preview.createdBy) !== String(adminId)) fail("Only the administrator who previewed this adjustment can apply it",403);
  if (preview.status === "COMPLETED") return summarize(preview);
  if (preview.expiresAt < new Date()) fail("Preview expired. Create a new preview.",409);
  if (preview.entries.length) await Earning.bulkWrite(preview.entries.map(e => ({
    updateOne: {
      filter: { _id: e.earningId, commissionAmount: e.oldAmount, commissionPercentage: e.oldRate,
        status: e.status, "adjustments.requestId": { $ne: preview._id } },
      update: { $set: { commissionAmount: e.newAmount, commissionPercentage: preview.rate },
        $push: { adjustments: { requestId: preview._id, previousRate: e.oldRate, previousAmount: e.oldAmount,
          newRate: preview.rate, newAmount: e.newAmount, changedAt: new Date(), changedBy: adminId } } },
    },
  })));
  preview.appliedCount = await Earning.countDocuments({ _id: { $in: preview.entries.map(e => e.earningId) }, "adjustments.requestId": preview._id });
  preview.status = preview.appliedCount === preview.entries.length ? "COMPLETED" : "PARTIAL";
  await preview.save();
  return summarize(preview);
};
module.exports = { previewAdjustment, applyAdjustment };
