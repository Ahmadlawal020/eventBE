const express = require("express");
const router = express.Router();
const {
  lookupUserByEmail,
  getUserById,
  updateUser,
  deleteUserAccount,
  requestChangeEmailOTP,
  verifyChangeEmailOTP,
} = require("../../controllers/client/userProfile.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// @route   POST /api/user-info/change-email/request
// @desc    Request OTP to change email address
// @access  Private
router.post("/change-email/request", verifyJWT, requestChangeEmailOTP);

// @route   POST /api/user-info/change-email/verify
// @desc    Verify OTP and change email address
// @access  Private
router.post("/change-email/verify", verifyJWT, verifyChangeEmailOTP);

// @route   GET /api/user-info/lookup?email=...
// @desc    Look up a user by email (name + email + picture)
// @access  Private
router.get("/lookup", verifyJWT, lookupUserByEmail);

// @route   GET /api/user-info/:id
// @desc    Get user by ID
// @access  Private
router.get("/:id", verifyJWT, getUserById);

// @route   PATCH /api/user-info/:id
// @desc    Update user
// @access  Private
router.patch("/:id", verifyJWT, updateUser);

// @route   DELETE /api/user-info/:id
// @desc    Delete user account and personal data
// @access  Private
router.delete("/:id", verifyJWT, deleteUserAccount);

module.exports = router;
