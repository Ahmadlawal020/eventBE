const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true },
    refundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventRefund",
      required: true,
    },
    organiser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    settlementId: String,
    state: {
      type: String,
      enum: ["PENDING", "ATTACHED", "CLEANING", "DELETED"],
      default: "PENDING",
    },
    expiresAt: { type: Date, required: true },
    cleanupAfter: { type: Date, required: true },
    lastError: String,
  },
  { timestamps: true },
);
schema.index({ state: 1, cleanupAfter: 1 });
schema.index({ organiser: 1, createdAt: -1 });
module.exports = mongoose.model("RefundUploadAttempt", schema);
