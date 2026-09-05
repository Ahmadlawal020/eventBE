const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, default: null },
    publicId: { type: String, default: null },
  },
  { _id: false }
);

const identityVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    idType: {
      type: String,
      enum: ["DL", "PP", "ID"],
      required: true,
    },
    idFrontImage: {
      type: imageSchema,
      required: true,
    },
    idBackImage: {
      type: imageSchema,
      default: null,
    },
    selfieImage: {
      type: imageSchema,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure one active verification per user (latest takes precedence)
identityVerificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "IdentityVerification",
  identityVerificationSchema
);
