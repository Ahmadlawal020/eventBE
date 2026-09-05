const express = require("express");
const router = express.Router();
const {
  lookupUserByEmail,
  getUserById,
  updateUser,
  deleteUserAccount,
} = require("../../controllers/client/userProfile.controller");
const verifyJWT = require("../../middleware/verifyJWT");

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
