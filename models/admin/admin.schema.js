const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const staffSchema = new mongoose.Schema(
  {
    // Basic Personal Information
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    surname: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
    },

    // Extended Personal Information
    gender: {
      type: String,
      enum: ["Male", "Female", "Other", "Prefer not to say"],
    },
    dateOfBirth: {
      type: Date,
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },

    // Employment Details
    department: {
      type: String,
      trim: true,
    },
    jobTitle: {
      type: String,
      trim: true,
    },
    employmentType: {
      type: String,
      enum: ["Full-time", "Part-time", "Contract", "Intern", "Temporary"],
      default: "Full-time",
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
    },
    branch: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
    },

    // Roles and Permissions
    roles: {
      type: [String],
      default: ["staff"],
    },
    accessLevel: {
      type: String,
      enum: ["Tier 1 Basic", "Tier 2 Management", "Tier 3 Senior", "Tier 4 Executive"],
      default: "Tier 2 Management",
    },
    teams: [{
      type: String,
      trim: true,
    }],

    // Account Status
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "terminated"],
      default: "active",
    },
    accountStatus: {
      type: String,
      enum: ["Active", "Suspended", "Locked", "Pending"],
      default: "Active",
    },

    // Security Information
    tfaEnabled: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
    },
    lastActiveAt: {
      type: Date,
    },
    passwordChangedAt: {
      type: Date,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    ipHistory: [{
      ip: String,
      timestamp: Date,
    }],
    devices: [{
      deviceName: String,
      deviceType: String,
      lastUsed: Date,
    }],
    activeSessions: {
      type: Number,
      default: 0,
    },

    // Profile
    profilePicture: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },

    // Authentication
    refreshToken: {
      type: String,
      default: null,
    },
    inviteToken: {
      type: String,
      default: null,
    },
    inviteTokenExpiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);



module.exports = mongoose.model("Staff", staffSchema);