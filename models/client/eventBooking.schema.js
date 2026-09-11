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
        subtotalAmount: { type: Number, min: 0 },
        feeMode: {
          type: String,
          enum: ["PASS_TO_BUYER", "ABSORB_BY_ORGANISER"],
        },
        feeAmount: { type: Number, min: 0 },
        buyerFeeAmount: { type: Number, min: 0 },
        organiserFeeAmount: { type: Number, min: 0 },
      },
    ],
    // Immutable checkout totals in the currency's smallest unit.
    subtotalAmount: { type: Number, min: 0 },
    platformFeeAmount: { type: Number, min: 0 },
    buyerFeeAmount: { type: Number, min: 0 },
    organiserFeeAmount: { type: Number, min: 0 },
    organiserPayoutAmount: { type: Number, min: 0 },
    feePercentage: { type: Number, min: 0, max: 100 },
    feeMode: {
      type: String,
      enum: [
        "ORGANISER_CHOICE",
        "PASS_TO_BUYER",
        "ABSORB_BY_ORGANISER",
      ],
    },
    fixedFeeAmount: { type: Number, min: 0 },
    totalAmount: { type: Number, required: true }, // amount charged, in cents
    currency: { type: String, default: "NGN" },
    referralQualifiedAt: { type: Date, default: null },
    referralPaymentAt: { type: Date, default: null },
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

eventBookingSchema.pre("save", function () {
  if (!this.referralQualifiedAt && this.paymentStatus === "COMPLETED" &&
      (this.isNew || this.isModified("paymentStatus"))) this.referralQualifiedAt = this.referralPaymentAt || new Date();
});
module.exports = model("EventBooking", eventBookingSchema);
