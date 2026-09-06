const mongoose = require("mongoose");

const referralEarningSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: ["EVENT_TICKET", "EVENT_CENTER_BOOKING"],
      required: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      default: null,
    },
    eventCenterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventCenter",
      default: null,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    bookingReference: {
      type: String,
      required: true,
      index: true,
    },
    totalAmount: {
      type: Number,
      required: true, // in Naira
    },
    commissionPercentage: {
      type: Number,
      required: true, // e.g. 5
    },
    commissionAmount: {
      type: Number,
      required: true, // in Naira
    },
    status: {
      type: String,
      enum: ["COMPLETED", "PENDING", "REFUNDED"],
      default: "COMPLETED",
    },
    currency: {
      type: String,
      default: "NGN",
    },
    qualifiedAt: { type: Date, default: null, index: true },
    policyVersions: [{ key: String, version: Number, _id: false }],
    adjustments: [{
      requestId: { type: mongoose.Schema.Types.ObjectId, ref: "ReferralAdjustment" },
      previousRate: Number, previousAmount: Number,
      newRate: Number, newAmount: Number,
      changedAt: Date, changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
      _id: false,
    }],
    notes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// Prevent duplicate commission crediting for the same booking + referrer + sourceType
referralEarningSchema.index(
  { bookingReference: 1, referrer: 1, sourceType: 1 },
  { unique: true }
);

// Compound index for fast queries by referrer
referralEarningSchema.index({ referrer: 1, createdAt: -1 });

module.exports = mongoose.model("ReferralEarning", referralEarningSchema);
