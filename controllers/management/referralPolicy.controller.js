const mongoose = require("mongoose");
const User = require("../../models/client/user.schema");
const { getPolicies, savePolicy } = require("../../services/referralPolicy.service");
const { previewAdjustment, applyAdjustment } = require("../../services/referralAdjustment.service");
const endpoint = (fn) => async (req,res) => {
  try { res.json({ success: true, data: await fn(req) }); }
  catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Could not update referral settings" }); }
};
const listPolicies = endpoint(() => getPolicies());
const updatePolicy = endpoint(req => savePolicy(req.params.key, req.body, req.user.id));
const createGroup = endpoint(req => savePolicy("GROUP:" + new mongoose.Types.ObjectId(), { ...req.body, expectedVersion: 0 }, req.user.id));
const searchUsers = endpoint(async req => {
  if (req.query.ids) {
    const ids = String(req.query.ids).split(",");
    if (ids.length > 500 || ids.some(id => !mongoose.isValidObjectId(id))) { const e = new Error("Invalid user selection"); e.status=400; throw e; }
    return User.find({ _id: { $in: ids } }).select("firstName surname email referralCode").lean();
  }
  const q = String(req.query.q || "").trim().slice(0,100);
  const escaped = q.replace(/[.*+?^$()|[\]\\{}]/g, "\\PAYLOAD");
  const filter = q ? { $or: ["firstName","surname","email","referralCode"].map(field => ({ [field]: { $regex: escaped, $options: "i" } })) } : {};
  return User.find(filter).select("firstName surname email referralCode").limit(50).lean();
});
const previewRates = endpoint(req => previewAdjustment(req.body, req.user.id));
const applyRates = endpoint(req => {
  if (!mongoose.isValidObjectId(req.params.id)) { const e = new Error("Invalid adjustment ID"); e.status=400; throw e; }
  return applyAdjustment(req.params.id, req.user.id, req.body.confirm);
});
module.exports = { listPolicies, updatePolicy, createGroup, searchUsers, previewRates, applyRates };
