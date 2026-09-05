const mongoose = require("mongoose");

const staffActivitySchema = new mongoose.Schema(
  {
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organiser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: ["SCAN", "CHECK_IN", "SALE", "LOGIN", "PERMISSION_CHANGE", "TASK_COMPLETE"],
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    metadata: {
      type: Object, // Stores IDs like ticketId, eventId, etc.
    },
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true }
);

// Indexes for fast dashboard lookups
staffActivitySchema.index({ staff: 1, createdAt: -1 });
staffActivitySchema.index({ organiser: 1, createdAt: -1 });

module.exports = mongoose.model("StaffActivity", staffActivitySchema);
