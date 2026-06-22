const User = require("../../models/user/user.schema");
const bcrypt = require("bcrypt");
const asyncHandler = require("express-async-handler");
const cloudinary = require("../../utils/cloudinary");

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
  if (email && email !== user.email) {
    const duplicate = await User.findOne({ email }).lean().exec();
    if (duplicate) {
      return res.status(409).json({ message: "Email already in use." });
    }
    user.email = email;
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
    user.residentialAddress = { ...user.residentialAddress.toObject(), ...residentialAddress };
  }
  if (emergencyContact) {
    user.emergencyContact = { ...user.emergencyContact.toObject(), ...emergencyContact };
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
  }

  const updatedUser = await user.save();

  // Sync event centers status if verification status changed
  const { syncUserEventCenters } = require("./eventCenter.controller");
  const { syncUserEvents } = require("./event.controller");
  await syncUserEventCenters(updatedUser._id);
  await syncUserEvents(updatedUser._id);

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
      isPhoneVerified: updatedUser.isPhoneVerified,
      phoneVerifiedAt: updatedUser.phoneVerifiedAt,
      hasPassword: !!updatedUser.password,
    },
  });
});

module.exports = {
  getUserById,
  updateUser,
};
