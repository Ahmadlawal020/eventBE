const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getSettings,
  updateSettings,
} = require("../../controllers/admin/adminSettings.controller");

router.get("/", verifyAdmin, getSettings);
router.put("/", verifyAdmin, updateSettings);

module.exports = router;
