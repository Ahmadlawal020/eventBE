const mongoose = require("mongoose");

const ticketTransferRequestSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    ticketCategory: {
      type: String,
      enum: ["USER_EVENT", "EVENT_CENTER"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },
  },
  { timestamps: true }
);

// Compound index: fast lookup for "my pending received requests"
ticketTransferRequestSchema.index({ recipient: 1, status: 1 });

// Compound index: fast lookup for "my pending sent requests"
ticketTransferRequestSchema.index({ sender: 1, status: 1 });

// Prevent duplicate pending requests for the same ticket
ticketTransferRequestSchema.index(
  { ticketId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "PENDING" } }
);

module.exports = mongoose.model(
  "TicketTransferRequest",
  ticketTransferRequestSchema
);
