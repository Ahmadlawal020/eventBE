const mongoose = require("mongoose");
const auditSchema = new mongoose.Schema({
  status: { type: String, enum: ["ATTENDED", "NO_SHOW"], required: true },
  previousStatus: String,
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  at: { type: Date, required: true },
  reason: { type: String, maxlength: 500 },
  method: { type: String, enum: ["MANUAL", "QR"], required: true },
  proofVerified: Boolean,
}, { _id: false });
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  eventCenter: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenter", required: true, index: true },
  bookingId: { type: String, required: true },
  sessionId: { type: String, required: true },
  status: { type: String, enum: ["ATTENDED", "NO_SHOW"], required: true },
  revision: { type: Number, required: true },
  // State and its audit entry are written atomically in the same document.
  audit: { type: [auditSchema], required: true },
}, { timestamps: true });
schema.index({ eventCenter: 1, bookingId: 1, sessionId: 1 }, { unique: true });
module.exports = mongoose.model("BookingAttendance", schema);
