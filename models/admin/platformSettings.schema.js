const { Schema, model } = require("mongoose");

const PlatformSettingsSchema = new Schema(
  {
    key: {
      type: String,
      default: "platform_settings",
      unique: true,
    },
    platformName: {
      type: String,
      default: "Munasaba",
    },
    supportEmail: {
      type: String,
      default: "support@munasaba.com",
    },
    supportPhone: {
      type: String,
      default: "",
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    registrationEnabled: {
      type: Boolean,
      default: true,
    },
    defaultCurrency: {
      type: String,
      default: "USD",
    },
    maxUploadSizeMB: {
      type: Number,
      default: 10,
      min: 1,
      max: 50,
    },
    sessionTimeoutMinutes: {
      type: Number,
      default: 15,
      min: 5,
      max: 120,
    },
    requireEmailVerification: {
      type: Boolean,
      default: true,
    },
    allowGoogleAuth: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = model("PlatformSettings", PlatformSettingsSchema);
