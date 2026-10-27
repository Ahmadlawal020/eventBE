const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema({
  country: { type: String, trim: true },
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

const pushTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, trim: true },
  platform: { type: String, enum: ["ios", "android", "web"], default: "android" },
  deviceId: { type: String, trim: true },
  deviceModel: { type: String, trim: true },
  lastUsedAt: { type: Date, default: Date.now },
}, { _id: false });

const notificationPreferencesSchema = new mongoose.Schema({
  channels: {
    push: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
  },
  categories: {
    bookings: { type: Boolean, default: true },
    tickets: { type: Boolean, default: true },
    teamAndInvites: { type: Boolean, default: true },
    messages: { type: Boolean, default: true },
    reminders: { type: Boolean, default: true },
    offersAndPromotions: { type: Boolean, default: true },
    newsAndUpdates: { type: Boolean, default: true },
  },
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
      // Make password optional for Google OAuth users or users transitioning to local
      required: function () {
        return this.isNew && this.authProvider === "local";
      },
    },
    dob: {
      type: Date,
      // Make dob optional for Google OAuth users or users transitioning to local
      required: function () {
        return this.isNew && this.authProvider === "local";
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
      default: false,
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
    vendorAccountCode: {
      type: String,
      default: null,
      index: true,
    },
    // Legacy alias — kept during migration period
    paystackSubaccountCode: {
      type: String,
      default: null,
    },
    bankDetails: {
      accountName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      bankName: { type: String, trim: true },
      bankCode: { type: String, trim: true },
    },
    // Push Notifications & Preferences
    pushTokens: {
      type: [pushTokenSchema],
      default: () => [],
    },
    notificationPreferences: {
      type: notificationPreferencesSchema,
      default: () => ({}),
    },
    // Referral Program Fields
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    referredAt: {
      type: Date,
      default: null,
    },
    referralEarnings: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

userSchema.add({ sessionVersion: { type: Number, default: 0 } });

// Assign codes across every account creation path.
userSchema.pre("validate", function () {
  if (!this.referralCode) this.referralCode = require("../../utils/referralCode").codeForUser(this._id);
});

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

userSchema.virtual("coOrganisedEvents", {
  ref: "Event",
  localField: "_id",
  foreignField: "coOrganisers",
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

userSchema.virtual("coOrganisedEventCenters", {
  ref: "EventCenter",
  localField: "_id",
  foreignField: "coOrganisers",
});

userSchema.virtual("staffedEventCenters", {
  ref: "EventCenter",
  localField: "_id",
  foreignField: "staff",
});

module.exports = mongoose.model("User", userSchema);
