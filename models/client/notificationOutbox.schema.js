const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: mongoose.Schema.Types.Mixed,
  inAppSentAt: Date,
  emailSentAt: Date,
  completedAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: () => new Date(0) },
  lockToken: String,
  lastError: String,
}, { timestamps: true });
schema.index({ completedAt: 1, nextAttemptAt: 1, lockedUntil: 1 });
module.exports = mongoose.model("NotificationOutbox", schema);
