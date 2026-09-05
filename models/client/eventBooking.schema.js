const { Schema, model } = require("mongoose");

const eventBookingSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    buyer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    guestDetails: {
      fullName: { type: String },
      phoneNumber: { type: String },
      email: { type: String }
    },
    items: [
      {
        ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        pricePerUnit: { type: Number, required: true }, // in cents
        totalPrice: { type: Number, required: true }, // in cents
      },
    ],
    totalAmount: { type: Number, required: true }, // in cents
    currency: { type: String, default: "NGN" },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "REFUNDED"],
      default: "PENDING",
    },
    paymentMethod: {
      type: String,
      enum: ["CARD", "TRANSFER", "FREE", "PAYSTACK"], // PAYSTACK kept for migration
      required: true,
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
      enum: ["ACTIVE", "CANCELLED", "COMPLETED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

module.exports = model("EventBooking", eventBookingSchema);
