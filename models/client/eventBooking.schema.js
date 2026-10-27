const { Schema, model } = require("mongoose");

const eventBookingSchema = new Schema(
  {
    occurrence: { type: Number, default: 0, min: 0 },
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
    checkoutKey: String,
    checkoutFingerprint: String,
    checkoutPricing: Schema.Types.Mixed,
    checkoutSubaccount: { type: String, select: false },
    initializationLockedUntil: Date,
    initializationToken: { type: String, select: false },
    checkoutAccessCode: {type:String, select:false},
    checkoutUrl: {type:String, select:false},
    paymentResolutionRequired: {type:Boolean, default:false},
    paymentResolution: {
      owner: { type: Schema.Types.ObjectId, ref: "Staff" },
      claimedAt: Date, resolvedAt: Date, resolvedBy: { type: Schema.Types.ObjectId, ref: "Staff" },
      settlementReference: String, notes: String,
    },
    reservationExpiresAt: {type:Date, index:true},
    reservationReconciliation: {
      attempts: { type: Number, default: 0 },
      lastCheckedAt: Date,
      nextAttemptAt: Date,
      lastError: { type: String, select: false },
    },
    inventoryReserved: {type:Boolean, default:false},
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

eventBookingSchema.index({ buyer: 1, checkoutKey: 1 }, { unique: true, partialFilterExpression: { checkoutKey: { $type: "string" } } });
eventBookingSchema.pre("save", function () {
  if (!this.referralQualifiedAt && this.paymentStatus === "COMPLETED" &&
      (this.isNew || this.isModified("paymentStatus"))) this.referralQualifiedAt = this.referralPaymentAt || new Date();
});
module.exports = model("EventBooking", eventBookingSchema);
