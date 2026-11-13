const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: function () { return !this.manualBookingClaim?.email; } },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: mongoose.Schema.Types.Mixed,
  receipt: mongoose.Schema.Types.Mixed,
  manualBookingClaim: { email: String, name: String, venueName: String, bookingId: String, operationsId: String, token: String, expiresAt: Date },
  channels: { type: [String], default: undefined },
  inAppSentAt: Date,
  emailSentAt: Date,
  pushSentAt: Date,
  pushDelivered: { type: [String], default: [] },
  completedAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: () => new Date(0) },
  lockToken: String,
  lastError: String,
  failedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ completedAt: 1, nextAttemptAt: 1, lockedUntil: 1 });
module.exports = mongoose.model("EventCenterRefundOutbox", schema);
