const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getStaffMembers,
  getStaffById,
  updateStaffProfile,
  inviteStaff,
  updateStaffRole,
  updateStaffStatus,
  updateStaffPassword,
  getStaffActivity,
  deleteStaff,
} = require("../../controllers/management/staff.controller");

router.use(verifyAdmin); // Protect all routes

router.get("/", getStaffMembers);
router.post("/invite", inviteStaff);
router.get("/:id", getStaffById);
router.patch("/:id", updateStaffProfile);
router.patch("/:id/roles", updateStaffRole);
router.patch("/:id/status", updateStaffStatus);
router.patch("/:id/password", updateStaffPassword);
router.get("/:id/activity", getStaffActivity);
router.delete("/:id", deleteStaff);

module.exports = router;
