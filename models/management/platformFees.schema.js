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
