const { Schema, model } = require("mongoose");

const TicketSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },

    // BASIC INFO
    name: { type: String, required: true },
    description: { type: String },
    additionalInstruction: { type: String },

    ticketType: {
      type: String,
      enum: ["PAID", "FREE", "DONATION"],
      required: true,
    },

    // INVENTORY
    totalQuantity: { type: Number, required: true },
    soldQuantity: { type: Number, default: 0 },

    perTransactionLimit: {
      min: { type: Number, default: 1 },
      max: { type: Number, default: 50 },
    },

    requiresApproval: { type: Boolean, default: false },

    // SALES WINDOW
    salesStartAt: { type: Date, required: true },
    salesEndAt: { type: Date, required: true },

    // CURRENCY
    currency: {
      code: { type: String, required: true }, // USD, EUR, etc
      symbol: { type: String, required: true },
    },

    // COMMISSION
    commission: {
      percentage: { type: Number, required: true }, // e.g. 15
      type: {
        type: String,
        enum: ["ADD_ON", "DEDUCT_FROM_PRICE"],
      },
    },

    // PAID TICKET PRICING (stored in cents)
    price: {
      amountCents: { type: Number },
    },

    // DONATION PRICING (stored in cents)
    donationRange: {
      minCents: { type: Number },
      maxCents: { type: Number },
    },

    // GROUPING
    groupName: { type: String },
  },
  { timestamps: true }
);

module.exports = model("Ticket", TicketSchema);
