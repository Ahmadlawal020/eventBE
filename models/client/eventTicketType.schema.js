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
    totalQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    soldQuantity: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },

    perTransactionLimit: {
      min: { type: Number, default: 1, min: 1, validate: Number.isSafeInteger },
      max: { type: Number, default: 50, min: 1, validate: Number.isSafeInteger },
    },

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
      amountCents: { type: Number, min: 0, validate: { validator: value => value == null || Number.isSafeInteger(value), message: "Ticket prices must use whole minor currency units." } },
    },

    // DONATION PRICING (stored in cents)
    donationRange: {
      minCents: { type: Number, min: 0, validate: { validator: value => value == null || Number.isSafeInteger(value) } },
      maxCents: { type: Number, min: 0, validate: { validator: value => value == null || Number.isSafeInteger(value) } },
    },

    // GROUPING
    groupName: { type: String },
  },
  { timestamps: true }
);

module.exports = model("EventTicketType", TicketSchema, "tickets");
