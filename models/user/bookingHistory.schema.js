const mongoose = require("mongoose");

const bookingHistorySchema = new mongoose.Schema(
  {
    eventCenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventCenter",
      required: true,
      index: true,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventCenterTicket",
      default: null,
    },
    bookingId: {
      type: String,
      required: true,
      index: true,
    },
    bookingType: {
      type: String,
      enum: ["PLATFORM", "MANUAL"],
      required: true,
    },
    bookingUnit: {
      type: String,
      enum: ["day", "hour"],
      default: "day",
    },
    action: {
      type: String,
      enum: ["CREATED", "RESCHEDULED", "CANCELLED", "CHECKED_IN", "PAYMENT_UPDATED"],
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    dates: [
      {
        date: { type: Date, required: true },
        startTime: { type: String },
        endTime: { type: String },
      },
    ],
    previousDates: [
      {
        date: { type: Date, required: true },
        startTime: { type: String },
        endTime: { type: String },
      },
    ],
    guestName: { type: String },
    reason: { type: String },
    totalPrice: {
      amount: { type: Number },
      currency: { type: String, default: "NGN" },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Prevent updates/deletes — entries are immutable
bookingHistorySchema.pre("findOneAndUpdate", function () {
  throw new Error("Booking history entries cannot be modified.");
});
bookingHistorySchema.pre("findOneAndDelete", function () {
  throw new Error("Booking history entries cannot be deleted.");
});

// Compound index for venue-scoped queries with sort
bookingHistorySchema.index({ eventCenter: 1, createdAt: -1 });

module.exports = mongoose.model("BookingHistory", bookingHistorySchema);
