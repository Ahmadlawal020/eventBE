const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  publicId: { type: String, required: true, unique: true }, recordId: { type: String, required: true }, refundId: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, settlementId: { type: String, required: true },
  state: { type: String, enum: ["PENDING", "ATTACHED", "CLEANING", "DELETED"], default: "PENDING" },
  expiresAt: Date, cleanupAfter: Date, lastError: String,
}, { timestamps: true });
schema.index({ state: 1, cleanupAfter: 1 });
module.exports = mongoose.model("ManualRefundUpload", schema);
