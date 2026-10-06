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
    team: { type: String, trim: true },
    organization: { type: String, trim: true },
    employeeId: { type: String, trim: true, index: true, sparse: true },
    startDate: {
      type: Date,
    },
    accessExpiresAt: { type: Date, default: null },

    // Roles and Permissions
    roles: {
      type: [String],
      enum: ["super_admin", "finance_admin", "moderator"],
      validate: {
        validator: (roles) => Array.isArray(roles) && roles.length === 1,
        message: "A staff member must have exactly one role",
      },
      required: true,
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
    accessScope: {
      type: { type: String, enum: ["platform", "limited"], default: "platform" },
      eventIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
      venueIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "EventCenter" }],
      departments: [{ type: String, trim: true }],
      regions: [{ type: String, trim: true }],
    },
    dataRestrictions: [{
      type: String,
      enum: ["financial_data", "attendee_pii", "identity_documents", "export_data"],
    }],
    segregationRules: [{ type: String, trim: true }],
    pageOverrides: [{
      routePath: { type: String, required: true, trim: true },
      allowed: { type: Boolean, required: true },
      _id: false,
    }],

    geographicAccess: {
      type: new mongoose.Schema({
        mode: { type: String, enum: ["global", "scoped"], default: "scoped" },
        grants: [{
          location: { type: mongoose.Schema.Types.ObjectId, ref: "GeographicLocation", required: true },
          role: { type: String, enum: ["viewer", "moderator", "regional_manager"], required: true },
          includeDescendants: { type: Boolean, default: true },
          expiresAt: { type: Date, default: null },
          _id: false,
        }],
      }, { _id: false }),
      default: undefined,
    },

    // Account Status
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "deactivated", "terminated"],
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
    mfaRequired: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    authenticationMethod: {
      type: String,
      enum: ["password", "passwordless", "sso"],
      default: "password",
    },
    identityProviderId: { type: String, trim: true, select: false },
    securityVersion: { type: Number, default: 0 },
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
    lockoutUntil: { type: Date, default: null },
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
    preferredLanguage: { type: String, trim: true, default: "en" },
    timezone: { type: String, trim: true, default: "Africa/Lagos" },
    notificationPreferences: {
      security: { type: Boolean, default: true },
      assignments: { type: Boolean, default: true },
      digest: { type: Boolean, default: false },
    },

    // Governance metadata is system-managed and never editable as profile data.
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    invitedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    suspensionReason: { type: String, trim: true },
    policyAcknowledgement: {
      version: { type: String, trim: true },
      acknowledgedAt: { type: Date },
    },

    // Authentication
    refreshToken: {
      type: String,
      default: null,
    },
    inviteToken: {
      type: String,
      default: null,
      select: false,
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

staffSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordChangedAt = new Date();
});

module.exports = mongoose.model("Staff", staffSchema);
