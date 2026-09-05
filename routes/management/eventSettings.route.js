const express = require("express");
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getAdminEventSettings,
  updateAdminEventSettings,
} = require("../../controllers/management/eventSettings.controller");

const router = express.Router();

router.get("/", verifyAdmin, getAdminEventSettings);
router.put("/", verifyAdmin, updateAdminEventSettings);

module.exports = router;
