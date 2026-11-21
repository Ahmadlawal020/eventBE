const express = require("express");
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const { requireAdminRoles } = verifyAdmin;
const {
  getAdminEventCenterSettings,
  updateAdminEventCenterSettings,
} = require("../../controllers/management/eventCenterSettings.controller");

const router = express.Router();
router.get("/", verifyAdmin, getAdminEventCenterSettings);
router.put("/", verifyAdmin, requireAdminRoles(["admin", "super_admin", "superadmin"], "Global administrator access required"), updateAdminEventCenterSettings);

module.exports = router;
