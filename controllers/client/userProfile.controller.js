const User = require("../../models/client/user.schema");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const cloudinary = require("../../utils/cloudinary");
const otpService = require("../../services/otp.service");

// @desc    Look up a user by email (lightweight — name + email + picture only)
// @route   GET /api/user-info/lookup?email=...
// @access  Private
const lookupUserByEmail = asyncHandler(async (req, res) => {
  const { email } = req.query;

  if (!email || typeof email !== "string" || !email.trim()) {
    return res.status(400).json({ success: false, message: "Email query param is required." });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select("firstName surname email profilePicture")
    .lean();

  if (!user) {
    return res.status(404).json({ success: false, message: "No user found with that email." });
  }

  res.status(200).json({
    success: true,
    data: {
      id: user._id,
      firstName: user.firstName,
      surname: user.surname,
      fullName: `${user.firstName || ""} ${user.surname || ""}`.trim(),
      email: user.email,
      profilePicture: user.profilePicture,
    },
  });
});

// @desc    Get user by ID
// @route   GET /api/user-info/:id
// @access  Private
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Ownership check: users can only view their own profile
  if (req.user.id !== id) {
    return res.status(403).json({ message: "Not authorized to view this profile." });
  }

  const user = await User.findById(id).lean();

  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  // Remove sensitive fields
  user.id = user._id;
  user.hasPassword = !!user.password;
  delete user.password;
  delete user.refreshToken;

  res.json(user);
});

// @desc    Update user profile
// @route   PATCH /api/user-info/:id
// @access  Private (owner only)
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Ownership check
  if (req.user.id !== id) {
    return res.status(403).json({ message: "Not authorized to update this profile." });
  }

  // Whitelist ONLY safe fields — roles (restricted to toggling 'organiser'), isActive, isIdentityVerified,
  // isPhoneVerified, phoneVerifiedAt are admin-only and NOT accepted here
  const {
    firstName,
    surname,
    preferredFirstName,
    phoneNumber,
    email,
    dob,
    password,
    residentialAddress,
    emergencyContact,
    preferredLanguage,
    profilePicture,
    roles,
  } = req.body;

  const user = await User.findById(id).exec();
  if (!user) return res.status(404).json({ message: "User not found." });

  // Prevent duplicate emails
  if (email && email.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
    const trimmedEmail = email.toLowerCase().trim();
    const duplicate = await User.findOne({ email: trimmedEmail, _id: { $ne: user._id } }).lean().exec();
    if (duplicate) {
      return res.status(409).json({ message: "The address has been taken" });
    }
    user.email = trimmedEmail;
    user.authProvider = "local";
    user.googleId = undefined;
  }

  user.firstName = firstName ?? user.firstName;
  user.surname = surname ?? user.surname;
  user.preferredFirstName = preferredFirstName ?? user.preferredFirstName;
  user.phoneNumber = phoneNumber ?? user.phoneNumber;
  user.dob = dob ?? user.dob;

  // Handle Profile Picture update and Cloudinary cleanup
  if (profilePicture && typeof profilePicture === 'object') {
    if (user.profilePicture?.publicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePicture.publicId);
      } catch (err) {
        console.error("[CLOUDINARY DELETE ERROR]", err);
      }
    }
    user.profilePicture = {
      url: profilePicture.url || null,
      publicId: profilePicture.publicId || null
    };
  }

  // Robustly update nested objects
  if (residentialAddress) {
    user.residentialAddress = { ...(user.residentialAddress?.toObject?.() || user.residentialAddress || {}), ...residentialAddress };
  }
  if (emergencyContact) {
    user.emergencyContact = { ...(user.emergencyContact?.toObject?.() || user.emergencyContact || {}), ...emergencyContact };
  }

  user.preferredLanguage = preferredLanguage ?? user.preferredLanguage;

  // Safe update for roles: users can toggle "organiser" themselves but cannot assign "admin" or "staff"
  if (roles && Array.isArray(roles)) {
    const allowedRoles = ["user", "organiser"];
    const verifiedRoles = roles.filter(role => allowedRoles.includes(role));
    const existingRestrictedRoles = user.roles.filter(role => !allowedRoles.includes(role));
    user.roles = [...new Set([...existingRestrictedRoles, ...verifiedRoles])];
  }

  if (password) {
    user.password = await bcrypt.hash(password, 10);
    user.$inc("sessionVersion", 1);
    user.refreshToken = "";
  }

  const updatedUser = await user.save();

  // Profile fields do not change the verification flags used for publishing.

  res.json({
    message: `User ${updatedUser.firstName} ${updatedUser.surname} updated successfully.`,
    user: {
      id: updatedUser._id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      surname: updatedUser.surname,
      preferredFirstName: updatedUser.preferredFirstName,
      phoneNumber: updatedUser.phoneNumber,
      roles: updatedUser.roles,
      dob: updatedUser.dob,
      profilePicture: updatedUser.profilePicture,
      residentialAddress: updatedUser.residentialAddress,
      emergencyContact: updatedUser.emergencyContact,
      preferredLanguage: updatedUser.preferredLanguage,
      isActive: updatedUser.isActive,
      isIdentityVerified: updatedUser.isIdentityVerified,
      isEmailVerified: updatedUser.isEmailVerified,
      emailVerifiedAt: updatedUser.emailVerifiedAt,
      isPhoneVerified: updatedUser.isPhoneVerified,
      phoneVerifiedAt: updatedUser.phoneVerifiedAt,
      hasPassword: !!updatedUser.password,
    },
  });
});

// @desc    Delete user account and all personal data
// @route   DELETE /api/user-info/:id
// @access  Private (owner only)
const deleteUserAccount = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (req.user.id !== id) {
    return res.status(403).json({ message: "Not authorized to delete this account." });
  }

  const user = await User.findById(id).exec();
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  // Cleanup Cloudinary profile picture
  if (user.profilePicture?.publicId) {
    try {
      await cloudinary.uploader.destroy(user.profilePicture.publicId);
    } catch (err) {
      console.error("[CLOUDINARY DELETE ERROR]", err);
    }
  }

  // Delete the user record
  await User.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: "Your account and associated personal data have been permanently deleted.",
  });
});

// 📧 Request OTP to change email
const requestChangeEmailOTP = asyncHandler(async (req, res) => {
  let { newEmail } = req.body;
  if (!newEmail || typeof newEmail !== "string" || !newEmail.trim()) {
    return res.status(400).json({ success: false, message: "New email is required." });
  }

  newEmail = newEmail.trim().toLowerCase();

  const user = await User.findById(req.user.id).exec();
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  if (user.email.toLowerCase() === newEmail) {
    return res.status(400).json({ success: false, message: "New email cannot be the same as your current email." });
  }

  // Check if email is already taken by another person
  const existingUser = await User.findOne({ email: newEmail, _id: { $ne: user._id } }).lean().exec();
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "The address has been taken",
    });
  }

  // Generate and send OTP
  await otpService.requestOTP(newEmail, "email_change");

  res.json({
    success: true,
    message: `Verification code sent to ${newEmail}`,
  });
});

// ✅ Verify OTP and update email (resets auth forms to local)
const verifyChangeEmailOTP = asyncHandler(async (req, res) => {
  let { newEmail, code } = req.body;
  if (!newEmail || !code) {
    return res.status(400).json({ success: false, message: "Email and verification code are required." });
  }

  newEmail = newEmail.trim().toLowerCase();

  const user = await User.findById(req.user.id).exec();
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  // Ensure not taken concurrently
  const existingUser = await User.findOne({ email: newEmail, _id: { $ne: user._id } }).lean().exec();
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "The address has been taken",
    });
  }

  // Verify OTP
  const result = await otpService.verifyOTP(newEmail, code.trim(), "email_change", { consume: true });
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message || "Invalid verification code",
    });
  }

  // Update user email and mark as verified
  user.email = newEmail;
  user.isEmailVerified = true;
  user.emailVerifiedAt = new Date();

  // Reset all other auth forms to local
  user.authProvider = "local";
  user.googleId = undefined;

  user.$inc("sessionVersion", 1);
  // Generate new tokens for the updated email
  const accessToken = jwt.sign(
    { UserInfo: { id: user._id, email: user.email, roles: user.roles, sessionVersion: user.sessionVersion || 0 } },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    { id: user._id, email: user.email, sessionVersion: user.sessionVersion || 0 },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  user.refreshToken = refreshToken;
  const updatedUser = await user.save();

  // Auto-sync event centers and events
  try {
    const { syncUserEventCenters } = require("./eventCenter.controller");
    const { syncUserEvents } = require("./event.controller");
    await syncUserEventCenters(updatedUser._id);
    await syncUserEvents(updatedUser._id);
  } catch (syncErr) {
    console.warn("[SYNC ERROR]", syncErr);
  }

  res.json({
    success: true,
    message: "Email address changed and verified successfully.",
    data: {
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        surname: updatedUser.surname,
        preferredFirstName: updatedUser.preferredFirstName,
        phoneNumber: updatedUser.phoneNumber,
        email: updatedUser.email,
        dob: updatedUser.dob,
        roles: updatedUser.roles,
        isEmailVerified: updatedUser.isEmailVerified,
        emailVerifiedAt: updatedUser.emailVerifiedAt,
        isPhoneVerified: updatedUser.isPhoneVerified,
        phoneVerifiedAt: updatedUser.phoneVerifiedAt,
        isIdentityVerified: updatedUser.isIdentityVerified,
        residentialAddress: updatedUser.residentialAddress,
        emergencyContact: updatedUser.emergencyContact,
        profilePicture: updatedUser.profilePicture,
        authProvider: updatedUser.authProvider,
        googleId: updatedUser.googleId,
        hasPassword: !!updatedUser.password,
      },
      accessToken,
      refreshToken,
    },
  });
});

module.exports = {
  lookupUserByEmail,
  getUserById,
  updateUser,
  deleteUserAccount,
  requestChangeEmailOTP,
  verifyChangeEmailOTP,
};
