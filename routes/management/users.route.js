const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getUsers,
  getUserDetails,
  updateUserStatus,
  updateUserVerification,
} = require("../../controllers/management/users.controller");

router.get("/", verifyAdmin, getUsers);
router.get("/:id", verifyAdmin, getUserDetails);
router.patch("/:id/status", verifyAdmin, updateUserStatus);
router.patch("/:id/verification", verifyAdmin, updateUserVerification);

module.exports = router;
