const PlatformFees = require("../../models/management/platformFees.schema");
const { recordAdminAction } = require("../../services/management/adminAudit.service");
const { ensureGlobalPolicy, savePolicy } = require("../../services/referralPolicy.service");
const responseData = (fees, policy) => {
  const rule = policy.revisions.at(-1);
  return { eventCommission: fees.eventCommission, eventCenterCommission: fees.eventCenterCommission,
    referralCommission: rule.commissionPercentage,
    referralDurationDays: rule.duration.unit === "DAYS" ? rule.duration.value : rule.duration.unit === "WEEKS" ? rule.duration.value * 7 : null,
    referralProgramEnabled: rule.status === "ACTIVE", referralStatus: rule.status,
    referralDuration: rule.duration, referralEntryWindow: rule.entryWindow, referralPolicyVersion: policy.version };
};
const getPlatformFees = async (req,res) => {
  try {
    const fees = await PlatformFees.findOneAndUpdate({ key: "platform_fees" },
      { $setOnInsert: { key: "platform_fees" } }, { upsert: true, new: true });
    res.json({ success: true, data: responseData(fees, await ensureGlobalPolicy()) });
  } catch (error) { res.status(500).json({ success: false, message: "Could not load platform settings" }); }
};
const updatePlatformFees = async (req,res) => {
  try {
    if (!req.user.roles.some(role => ["admin","super_admin","finance_admin"].includes(role))) return res.status(403).json({ success:false, message:"Finance or full administrator access required" });
    let policy = await ensureGlobalPolicy();
    const rule = policy.revisions.at(-1);
    const patch = { expectedVersion: policy.version, reason: "Updated through platform-fee settings" };
    const update = {};
    for (const field of ["eventCommission","eventCenterCommission","referralCommission"]) {
      if (!(field in req.body)) continue;
      const value = req.body[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return res.status(400).json({ success:false, message: field + " must be between 0 and 100" });
      if (field === "referralCommission") { if (value !== rule.commissionPercentage) patch.commissionPercentage = value; }
      else update[field] = value;
    }
    if ("referralDurationDays" in req.body) {
      const days = req.body.referralDurationDays;
      if (!Number.isInteger(days) || days < 0) return res.status(400).json({ success:false,message:"Invalid referral duration" });
      if (rule.duration.unit !== "DAYS" || rule.duration.value !== days) patch.duration = { value: days, unit: "DAYS" };
    }
    if ("referralProgramEnabled" in req.body) {
      const enabled = req.body.referralProgramEnabled;
      if (typeof enabled !== "boolean") return res.status(400).json({ success:false,message:"referralProgramEnabled must be a boolean" });
      if (enabled && rule.status === "ENDED") return res.status(409).json({ success:false,message:"Use Start in referral management to begin a new earning period" });
      if (enabled && rule.status === "PAUSED") patch.action = "RESUME";
      if (!enabled && rule.status === "ACTIVE") patch.action = "PAUSE";
    }
    const previous = await PlatformFees.findOne({ key:"platform_fees" }).lean();
    if (Object.keys(patch).length > 2) policy = await savePolicy("GLOBAL", patch, req.user.id);
    const fees = await PlatformFees.findOneAndUpdate({ key:"platform_fees" }, { $set:update }, { upsert:true,new:true,runValidators:true });
    await recordAdminAction({ req, action:"PLATFORM_FEES_UPDATED", targetType:"System", targetId:fees._id, previousValue:previous, newValue:responseData(fees,policy) });
    res.json({ success:true,data:responseData(fees,policy) });
  } catch(error) { res.status(error.status || 500).json({ success:false,message:error.status ? error.message : "Could not save platform settings" }); }
};
module.exports = { getPlatformFees, updatePlatformFees };
