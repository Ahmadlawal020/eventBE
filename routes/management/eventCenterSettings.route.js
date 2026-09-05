const express = require("express");
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getAdminEventCenterSettings,
  updateAdminEventCenterSettings,
} = require("../../controllers/management/eventCenterSettings.controller");

const router = express.Router();
router.get("/", verifyAdmin, getAdminEventCenterSettings);
router.put("/", verifyAdmin, updateAdminEventCenterSettings);

module.exports = router;
