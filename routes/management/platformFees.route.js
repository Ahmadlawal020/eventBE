const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getPlatformFees,
  updatePlatformFees,
} = require("../../controllers/management/platformFees.controller");

router.get("/", verifyAdmin, getPlatformFees);
router.put("/", verifyAdmin, updatePlatformFees);

module.exports = router;
