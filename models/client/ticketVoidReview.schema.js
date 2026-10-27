const { Schema, model } = require("mongoose");
const schema = new Schema({
  ticketId: { type: Schema.Types.ObjectId, ref: "UserEventTicket", required: true, unique: true },
  eventId: { type: Schema.Types.ObjectId, ref: "Event", required: true },
  holder: { type: Schema.Types.ObjectId, ref: "User", required: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  ticketNumber: String, occurrence: Number, amountMinor: Number, currency: String,
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "Staff" }, reviewedAt: Date,
  notes: String, settlementReference: String,
  heldAt: Date,
  history: [Schema.Types.Mixed],
}, { timestamps: true });
schema.index({ status: 1, createdAt: 1 });
module.exports = model("TicketVoidReview", schema);
