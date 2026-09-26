const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    requestId: { type: String, required: true },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true, maxlength: 160 },
    message: { type: String, required: true, maxlength: 5000 },
    targetGroup: {
      type: String,
      enum: ["all", "organisers", "staff"],
      required: true,
    },
    priority: {
      type: String,
      enum: ["NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
    },
    status: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "PARTIAL", "FAILED"],
      default: "PROCESSING",
    },
    recipientCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    pushCount: { type: Number, default: 0 },
    completedAt: Date,
  },
  { timestamps: true },
);
schema.index({ sentBy: 1, requestId: 1 }, { unique: true });
schema.index({ createdAt: -1, _id: -1 });
module.exports = mongoose.model("AdminBroadcast", schema);
