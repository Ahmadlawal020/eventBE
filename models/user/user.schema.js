const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema({
  country: { type: String, default: "Nigeria" },
  street: { type: String, trim: true },
  unit: { type: String, trim: true },
  city: { type: String, trim: true },
  county: { type: String, trim: true },
  postalCode: { type: String, trim: true },
}, { _id: false });

const emergencyContactSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  relationship: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phoneNumber: { type: String, trim: true },
}, { _id: false });

const userSchema = new mongoose.Schema(
  {
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
    preferredFirstName: {
      type: String,
      trim: true,
    },
    phoneNumber: {
      type: String,
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
      // Make password optional for Google OAuth users
      required: function () {
        return this.authProvider === "local";
      },
    },
    dob: {
      type: Date,
      // Make dob optional for Google OAuth users
      required: function () {
        return this.authProvider === "local";
      },
    },
    googleId: {
      type: String,
      sparse: true, // Allows multiple null values but enforces uniqueness for non-null
      unique: true, // This already creates an index, no need to call schema.index() again
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    profilePicture: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    roles: {
      type: [String],
      default: ["user"],
    },
    refreshToken: {
      type: String,
      default: null,
    },
    // Additional fields for better user management
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerifiedAt: {
      type: Date,
      default: null,
    },
    isIdentityVerified: {
      type: Boolean,
      default: true,
    },
    residentialAddress: {
      type: addressSchema,
      default: () => ({}),
    },
    emergencyContact: {
      type: emergencyContactSchema,
      default: () => ({}),
    },
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    preferredLanguage: {
      type: String,
      default: "en",
    },
    wishlistEvents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Event",
      },
    ],
    wishlistEventCenters: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "EventCenter",
      },
    ],
    // Finance / Payout fields
    paystackSubaccountCode: {
      type: String,
      default: null,
      index: true, // Enable sub-millisecond lookups for webhooks and finance audits
    },
    bankDetails: {
      accountName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      bankName: { type: String, trim: true },
      bankCode: { type: String, trim: true },
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better query performance
userSchema.index({ authProvider: 1 });

// Virtual for full name
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.surname}`.trim();
});

// Virtual populates for events and venues
userSchema.virtual("createdEvents", {
  ref: "Event",
  localField: "_id",
  foreignField: "createdBy",
});

userSchema.virtual("coHostedEvents", {
  ref: "Event",
  localField: "_id",
  foreignField: "coHosts",
});

userSchema.virtual("staffedEvents", {
  ref: "Event",
  localField: "_id",
  foreignField: "staff",
});

userSchema.virtual("createdEventCenters", {
  ref: "EventCenter",
  localField: "_id",
  foreignField: "createdBy",
});

userSchema.virtual("coHostedEventCenters", {
  ref: "EventCenter",
  localField: "_id",
  foreignField: "coHosts",
});

userSchema.virtual("staffedEventCenters", {
  ref: "EventCenter",
  localField: "_id",
  foreignField: "staff",
});

module.exports = mongoose.model("User", userSchema);
