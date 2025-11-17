const express = require("express");
const router = express.Router();
const {
  getUserById,
  updateUser,
} = require("../../controllers/user/info.controller");

// Optional: middleware imports
// const { protect, admin } = require("../middleware/authMiddleware");

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private
router.get("/:id", /* protect, */ getUserById);

// @route   PATCH /api/users/:id
// @desc    Update user
// @access  Private
router.patch("/:id", /* protect, */ updateUser);

module.exports = router;
