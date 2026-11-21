const mongoose = require("mongoose");
const schema = new mongoose.Schema({
 booking: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenterBooking", required: true },
 buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, organiser: mongoose.Schema.Types.ObjectId,
 eventCenter: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenter", required: true },
 paymentReference: { type: String, required: true, unique: true },
 status: { type: String, enum: ["ACTIVE", "COMPLETED", "CANCELLED"], default: "ACTIVE" },
 paymentStatus: { type: String, default: "PENDING" },
 totalPrice: { amount: Number, currency: String }, platformFeeAmount: Number,
 guestDetails: { email: String }, bookingMode: { type: String, default: "INSTANT" },
 checkoutSubaccount: { type: String, select: false }, checkoutSnapshotVersion: { type: Number, default: 1 },
 checkoutAccessCode: { type: String, select: false }, checkoutUrl: { type: String, select: false },
 checkoutToken: { type: String, select: false }, checkoutLockedUntil: Date, checkoutAttemptedAt: Date,
 reservationExpiresAt: Date, nextCheckAt: Date, paymentResolutionRequired: { type: Boolean, default: false },
 review: mongoose.Schema.Types.Mixed, reason: String, originalCount: Number, ledgerRevision: Number,
 refund: { state: String, amountMinor: Number, providerId: String, leaseUntil: Date, leaseToken: String, lastError: String, attempts: Number },
}, { timestamps: true });
schema.index({ status: 1, nextCheckAt: 1 });
schema.index({ booking: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" } });
module.exports = mongoose.model("VenueRescheduleCheckout", schema);
