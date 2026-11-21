const mongoose = require("mongoose");
module.exports = new mongoose.Schema({
  allowGuestCancellation: { type: Boolean, default: false },
  noticeHours: { type: Number, default: 24, min: 0, max: 8760, validate: Number.isInteger },
  noticeUnit: { type: String, enum: ["hours", "days"], default: "hours" },
  rescheduleApprovalRequired: { type: Boolean, default: true },
  allowGuestReschedule: { type: Boolean, default: false },
  maxReschedules: { type: Number, default: 1, min: 1, max: 100, validate: Number.isInteger },
  rescheduleNoticeHours: { type: Number, default: 0, min: 0, max: 8760, validate: Number.isInteger },
  rescheduleNoticeUnit: { type: String, enum: ["hours", "days"], default: "hours" },
  refundMinDays: { type: Number, default: 1, min: 1, max: 90, validate: Number.isInteger },
  refundDays: { type: Number, default: 7, min: 1, max: 90, validate: Number.isInteger },
  refundInstructions: { type: String, trim: true, maxlength: 2000, default: "" },
}, { _id: false });
