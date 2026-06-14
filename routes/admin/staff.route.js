const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getStaffs,
  getStaffById,
  inviteStaff,
  updateStaffRole,
  updateStaffStatus,
  updateStaffPassword,
  getStaffActivity,
  deleteStaff,
} = require("../../controllers/admin/adminStaff.controller");

router.use(verifyAdmin); // Protect all routes

router.get("/", getStaffs);
router.post("/invite", inviteStaff);
router.get("/:id", getStaffById);
router.patch("/:id/roles", updateStaffRole);
router.patch("/:id/status", updateStaffStatus);
router.patch("/:id/password", updateStaffPassword);
router.get("/:id/activity", getStaffActivity);
router.delete("/:id", deleteStaff);

module.exports = router;
