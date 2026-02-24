// Address sub-schema and other commented out code removed for clarity

// const mongoose = require("mongoose");

// const userSchema = new mongoose.Schema(
//   {
//     firstName: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     surname: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     email: {
//       type: String,
//       required: true,
//       unique: true,
//       lowercase: true,
//       trim: true,
//     },
//     password: {
//       type: String,
//       // Make password optional for Google OAuth users
//       required: function () {
//         return this.authProvider === "local";
//       },
//     },
//     dob: {
//       type: Date,
//       // Make dob optional for Google OAuth users
//       required: function () {
//         return this.authProvider === "local";
//       },
//     },
//     googleId: {
//       type: String,
//       sparse: true, // Allows multiple null values but enforces uniqueness for non-null
//       unique: true,
//     },
//     authProvider: {
//       type: String,
//       enum: ["local", "google"],
//       default: "local",
//     },
//     profilePicture: {
//       type: String,
//       default: null,
//     },
//     roles: {
//       type: [String],
//       default: ["user"],
//     },
//     refreshToken: {
//       type: String,
//       default: null,
//     },
//     // Additional fields for better user management
//     isEmailVerified: {
//       type: Boolean,
//       default: false,
//     },
//     emailVerifiedAt: {
//       type: Date,
//       default: null,
//     },
//     lastLoginAt: {
//       type: Date,
//       default: Date.now,
//     },
//   },
//   {
//     timestamps: true, // Adds createdAt and updatedAt automatically
//   }
// );

// // Index for better query performance
// userSchema.index({ email: 1 });
// userSchema.index({ googleId: 1 });
// userSchema.index({ authProvider: 1 });

// // Virtual for full name
// userSchema.virtual("fullName").get(function () {
//   return `${this.firstName} ${this.surname}`.trim();
// });

// // Method to check if user is Google authenticated
// userSchema.methods.isGoogleUser = function () {
//   return this.authProvider === "google";
// };

// // Method to check if user is local (email/password) authenticated
// userSchema.methods.isLocalUser = function () {
//   return this.authProvider === "local";
// };

// module.exports = mongoose.model("User", userSchema);

const mongoose = require("mongoose");

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
      type: String,
      default: null,
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
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

// Indexes for better query performance
userSchema.index({ authProvider: 1 });
// Removed googleId index to prevent duplicate warning

// Virtual for full name
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.surname}`.trim();
});

// Method to check if user is Google authenticated
userSchema.methods.isGoogleUser = function () {
  return this.authProvider === "google";
};

// Method to check if user is local (email/password) authenticated
userSchema.methods.isLocalUser = function () {
  return this.authProvider === "local";
};

module.exports = mongoose.model("User", userSchema);
