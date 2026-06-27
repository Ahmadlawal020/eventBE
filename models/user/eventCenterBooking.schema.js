const mongoose = require("mongoose");

const eventCenterTicketSchema = new mongoose.Schema(
  {
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    guestDetails: {
      fullName: { type: String },
      phoneNumber: { type: String },
      email: { type: String }
    },
    organiser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // Speed up organiser-scoped ticket queries
    },
    eventCenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventCenter",
      required: true,
      index: true,
    },
    selectedDates: [
      {
        date: { type: Date, required: true },
        startTime: { type: String }, // For hourly bookings
        endTime: { type: String },   // For hourly bookings
      },
    ],
    bookingUnit: {
      type: String,
      enum: ["hour", "day"],
      required: true,
    },
    duration: {
      type: Number,
      required: true,
    },
    totalPrice: {
      amount: { type: Number, required: true },
      currency: { type: String, default: "NGN" },
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "REFUNDED", "FAILED_REFUND"],
      default: "PENDING",
    },
    paymentReference: {
      type: String,
      unique: true,
      sparse: true,
    },
    // Legacy alias — kept during migration period
    paystackReference: {
      type: String,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "CANCELLED", "COMPLETED", "PENDING_REVIEW", "CONFIRMED"],
      default: "ACTIVE",
    },

    // ============================================================
    // REVIEW BOOKING FLOW
    // ============================================================
    bookingMode: {
      type: String,
      enum: ["INSTANT", "REVIEW"],
      default: "INSTANT",
    },
    reviewDeadline: { type: Date, index: true },
    reviewedAt: { type: Date },

    // ============================================================
    // QR CODE & ENTRY CONTROL (same pattern as event tickets)
    // ============================================================
    ticketNumber: {
      type: String,
      unique: true,
      sparse: true, // Allow null for legacy tickets before this feature
    },
    qrPayload: { type: String }, // HMAC-signed JSON for tamper-proof scanning

    // CHECK-IN TRACKING
    checkIn: {
      isCheckedIn: { type: Boolean, default: false },
      checkedInAt: Date,
      checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      method: {
        type: String,
        enum: ["QR", "MANUAL"],
      },
    },

    // TRANSFER HISTORY — immutable audit trail
    transferHistory: [
      {
        fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        toUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        transferredAt: { type: Date, default: Date.now },
        previousTicketNumber: { type: String },
      },
    ],
  },
  { timestamps: true }
);

// ============================================================================
// INDEXES FOR MILLION-SCALE OPERATIONS
// ============================================================================

// Fast ticket lookup by number (for scanning)
// ticketNumber already has a unique index from schema definition

// Compound index: buyer + eventCenter for "my bookings for this venue"
eventCenterTicketSchema.index({ buyer: 1, eventCenter: 1 });

// Compound index: eventCenter + status for venue analytics
eventCenterTicketSchema.index({ eventCenter: 1, status: 1 });

// Compound index: status + reviewDeadline for cron job expiry queries
eventCenterTicketSchema.index({ status: 1, reviewDeadline: 1 });


module.exports = mongoose.model("EventCenterBooking", eventCenterTicketSchema, "eventcentertickets");
