const mongoose = require("mongoose");
module.exports = mongoose.model("BookingReminder", new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  state: { type: String, enum: ["PENDING", "SENT"], default: "PENDING" },
  leaseUntil: Date, sentAt: Date,
}, { timestamps: true }));
