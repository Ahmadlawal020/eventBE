const User = require("../../models/user/user.schema");
const bcrypt = require("bcryptjs");
const asyncHandler = require("express-async-handler");

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id).select("-password -refreshToken").lean();

  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  res.json(user);
});

const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    firstName,
    surname,
    phoneNumber,
    email,
    dob,
    password,
    roles,
    residentialAddress,
    postalAddress,
    emergencyContact,
    preferredLanguage,
    isActive,
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
  user.phoneNumber = phoneNumber ?? user.phoneNumber;
  user.dob = dob ?? user.dob;

  // ✅ Fix: merge roles instead of replacing
  if (roles?.length) {
    const merged = new Set([...user.roles, ...roles]);
    user.roles = Array.from(merged);
  }

  user.residentialAddress = residentialAddress ?? user.residentialAddress;
  user.postalAddress = postalAddress ?? user.postalAddress;
  user.emergencyContact = emergencyContact ?? user.emergencyContact;
  user.preferredLanguage = preferredLanguage ?? user.preferredLanguage;
  user.isActive = typeof isActive === "boolean" ? isActive : user.isActive;

  if (password) {
    user.password = await bcrypt.hash(password, 10);
  }

  const updatedUser = await user.save();

  res.json({
    message: `User ${updatedUser.firstName} ${updatedUser.surname} updated successfully.`,
    user: {
      id: updatedUser._id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      surname: updatedUser.surname,
      roles: updatedUser.roles,
      dob: updatedUser.dob,
      residentialAddress: updatedUser.residentialAddress,
      postalAddress: updatedUser.postalAddress,
      emergencyContact: updatedUser.emergencyContact,
      preferredLanguage: updatedUser.preferredLanguage,
      isActive: updatedUser.isActive,
    },
  });
});

module.exports = {
  getUserById,
  updateUser,
};
