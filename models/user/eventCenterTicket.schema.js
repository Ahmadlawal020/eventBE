const mongoose = require("mongoose");

const eventCenterTicketSchema = new mongoose.Schema(
  {
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    },
    eventCenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventCenter",
      required: true,
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
      currency: { type: String, default: "NGN" }, // Paystack usually NGN
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "PENDING",
    },
    paystackReference: {
      type: String,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "CANCELLED", "COMPLETED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EventCenterTicket", eventCenterTicketSchema);
