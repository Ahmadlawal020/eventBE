const mongoose = require("mongoose");
const period = new mongoose.Schema({
  value: { type: Number, required: true, min: 0 },
  unit: { type: String, enum: ["DAYS", "WEEKS", "MONTHS"], required: true },
}, { _id: false });
const revision = new mongoose.Schema({
  version: { type: Number, required: true },
  effectiveAt: { type: Date, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  reason: { type: String, default: "" },
  name: String,
  userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  priority: { type: Number, default: 0 },
  commissionPercentage: { type: Number, min: 0, max: 100, default: null },
  duration: { type: period, default: null },
  entryWindow: { type: period, default: null },
  status: { type: String, enum: ["ACTIVE", "PAUSED", "ENDED", "INHERIT"], default: "INHERIT" },
  startedAt: { type: Date, default: null },
}, { _id: false });
const schema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  scope: { type: String, enum: ["GLOBAL", "GROUP", "USER"], required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  version: { type: Number, required: true },
  revisions: { type: [revision], required: true },
}, { timestamps: true });
module.exports = mongoose.model("ReferralPolicy", schema);
