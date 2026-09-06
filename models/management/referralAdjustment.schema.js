const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  scopeKey: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
  from: Date, to: Date, rate: { type: Number, required: true },
  reason: { type: String, required: true }, expiresAt: { type: Date, required: true },
  status: { type: String, enum: ["PREVIEW", "PARTIAL", "COMPLETED"], default: "PREVIEW" },
  entries: [{ earningId: mongoose.Schema.Types.ObjectId, oldRate: Number, oldAmount: Number,
    newAmount: Number, status: String, _id: false }],
  appliedCount: { type: Number, default: 0 },
}, { timestamps: true });
module.exports = mongoose.model("ReferralAdjustment", schema);
