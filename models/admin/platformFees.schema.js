const { Schema, model } = require("mongoose");

const PlatformFeesSchema = new Schema(
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
  },
  { timestamps: true }
);

module.exports = model("PlatformFees", PlatformFeesSchema);
