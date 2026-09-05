const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const otpSchema = new mongoose.Schema(
  {
    identifier: {
      type: String, // email or phone number
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["email", "phone", "password_change"],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: "10m" }, // Automatically delete after 10 minutes
    },
  },
  { timestamps: true }
);

// Hash the OTP code before saving
otpSchema.pre("save", async function (next) {
  if (!this.isModified("code")) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.code = await bcrypt.hash(this.code, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to verify OTP code
otpSchema.methods.verifyCode = async function (candidateCode) {
  return await bcrypt.compare(candidateCode, this.code);
};

module.exports = mongoose.model("OTP", otpSchema);
