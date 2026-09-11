const { Schema, model } = require("mongoose");

const platformFeesSchema = new Schema(
  {
    key: {
      type: String,
      default: "platform_fees",
      unique: true,
    },

    // Commission percentage charged on event tickets
    eventCommission: {
      type: Number,
      default: 15,
      min: 0,
      max: 100,
    },

    // Master switch for event ticket commissions and checkout charges.
    ticketFeesEnabled: {
      type: Boolean,
      default: true,
    },

    // Organisers can choose the fee treatment per ticket, or administrators can
    // force one treatment for every paid ticket on the platform.
    ticketFeeMode: {
      type: String,
      enum: [
        "ORGANISER_CHOICE",
        "PASS_TO_BUYER",
        "ABSORB_BY_ORGANISER",
      ],
      default: "ORGANISER_CHOICE",
    },

    // Flat charge applied once per paid ticket order, stored in the smallest
    // currency unit (kobo for NGN).
    ticketFixedFeeCents: {
      type: Number,
      default: 0,
      min: 0,
      max: 100000000,
    },

    // Optional maximum for the combined percentage + fixed platform charge.
    // `null` means uncapped; zero is an intentional zero-fee cap.
    ticketFeeCapCents: {
      type: Number,
      default: null,
      min: 0,
      max: 100000000,
    },

    // Commission percentage charged on event center bookings
    eventCenterCommission: {
      type: Number,
      default: 15,
      min: 0,
      max: 100,
    },

    // Referral Program Settings
    // Percentage earned by referrer from each ticket / booking
    referralCommission: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },

    // Referral duration window in days (0 means lifetime / unlimited)
    referralDurationDays: {
      type: Number,
      default: 90,
      min: 0,
    },

    // Toggle referral program on/off
    referralProgramEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = model("PlatformFees", platformFeesSchema);
