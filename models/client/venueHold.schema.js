const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  eventCenter: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenter", required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientName: { type: String, required: true, maxlength: 150 }, clientEmail: String, clientPhone: String,
  bookingUnit: { type: String, enum: ["day", "hour"], required: true },
  dates: [{ _id: false, date: Date, startTime: String, endTime: String }],
  expiresAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ["ACTIVE", "CONVERTED", "RELEASED", "EXPIRED"], default: "ACTIVE", index: true },
  bookingId: String,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, resolvedAt: Date,
}, { timestamps: true });
module.exports = mongoose.model("VenueHold", schema);
