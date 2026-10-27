const mongoose = require("mongoose");

// A record of a direct refund obligation. Munasaba does not move this money:
// the organiser pays the ticket holder directly and both sides can track its state.
const eventRefundSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "EventBooking", required: true, index: true },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "UserEventTicket" },
  originalBuyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  // API compatibility: buyer identifies the holder receiving this refund.
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  organiser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amountMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, default: "NGN" },
  // The platform never sends this transfer. Bank details are supplied only by
  // the buyer after cancellation and are visible only to the responsible organiser.
  bankDetails: {
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true, select: false },
    bankCode: { type: String, trim: true, select: false },
  },
  bankDetailsVersion: { type: Number, default: 0, min: 0 },
  // The bankDetails fields stay immutable while this settlement exists.
  settlement: {
    id: String,
    bankDetailsVersion: Number,
    preparedAt: Date,
    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  paidSettlementId: String,
  status: {
    type: String,
    enum: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER", "MARKED_PAID", "CONFIRMED_BY_BUYER", "DISPUTED", "OVERDUE"],
    default: "AWAITING_BUYER_DETAILS",
    index: true,
  },
  dueAt: { type: Date, required: true, index: true },
  organiserReference: { type: String, trim: true, maxlength: 200 },
  bankDetailsSubmittedAt: Date,
  receipt: {
    settlementId: String,
    publicId: { type: String, select: false },
    format: { type: String, enum: ["jpg", "jpeg", "png", "webp"] },
    uploadedAt: Date,
  },
  supportRequest: {
    reason: { type: String, maxlength: 1000 },
    requestedAt: Date,
    status: { type: String, enum: ["OPEN", "RESOLVED"] },
  },
  recoveryHistory: { type: [new mongoose.Schema({
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
    reason: String, recoveredAt: Date,
    bankDetails: mongoose.Schema.Types.Mixed,
    settlement: mongoose.Schema.Types.Mixed,
    receipt: mongoose.Schema.Types.Mixed,
  }, { _id: false })], select: false, default: undefined },
  pendingReceiptPublicId: { type: String, select: false },
  markedPaidAt: Date,
  confirmationDueAt: Date,
  confirmedAt: Date,
  disputeReason: { type: String, trim: true, maxlength: 1000 },
  // Internal operations record. This is intentionally hidden from the buyer
  // APIs: it is for EventMDB investigation, assignment, and resolution only.
  managementCase: {
    type: new mongoose.Schema({
      status: { type: String, enum: ["OPEN", "IN_REVIEW", "RESOLVED"], default: "OPEN" },
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
      notes: [{
        author: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
        body: { type: String, required: true, trim: true, maxlength: 2000 },
        createdAt: { type: Date, default: Date.now },
      }],
      resolution: { type: String, trim: true, maxlength: 2000 },
      resolvedAt: Date,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    }, { _id: false }),
    default: () => ({ status: "OPEN", notes: [] }),
    select: false,
  },
}, { timestamps: true });

eventRefundSchema.index({ eventId: 1, bookingId: 1, ticketId: 1 }, { unique: true });
eventRefundSchema.index({ ticketId: 1 }, { unique: true, partialFilterExpression: { ticketId: { $type: "objectId" } } });
eventRefundSchema.index({ organiser: 1, status: 1, dueAt: 1 });

module.exports = mongoose.model("EventRefund", eventRefundSchema);
