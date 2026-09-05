const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getSettings,
  updateSettings,
} = require("../../controllers/management/settings.controller");

router.get("/", verifyAdmin, getSettings);
router.put("/", verifyAdmin, updateSettings);

module.exports = router;
