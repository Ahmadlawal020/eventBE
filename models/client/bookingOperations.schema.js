const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  eventCenter: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenter", required: true, index: true },
  bookingId: { type: String, required: true },
  revision: { type: Number, default: 0 },
  openingPaidMinor: { type: Number, default: 0 },
  paymentDueDate: Date,
  eventPurpose: { type: String, maxlength: 200 },
  guestCount: { type: Number, min: 0 },
  seating: { type: String, maxlength: 500 },
  clientRequests: { type: String, maxlength: 2000 },
  privateNotes: { type: String, maxlength: 4000 },
  payments: [{ _id: false, id: String, kind: { type: String, enum: ["PAYMENT", "REFUND", "SECURITY_DEPOSIT", "SECURITY_RETURN"] },
    amountMinor: Number, method: String, reference: String, reason: String,
    at: Date, actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" } }],
  handovers: [{ _id: false, sessionId: String, checkedOutAt: Date, cleaned: Boolean, damageNotes: String, overtimeMinutes: Number,
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" } }],
  audit: [{ _id: false, action: String, at: Date, reason: String, actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" } }],
}, { timestamps: true });
schema.index({ eventCenter: 1, bookingId: 1 }, { unique: true });
module.exports = mongoose.model("BookingOperations", schema);
