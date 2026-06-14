const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getPlatformFees,
  updatePlatformFees,
} = require("../../controllers/admin/adminPlatformFees.controller");

router.get("/", verifyAdmin, getPlatformFees);
router.put("/", verifyAdmin, updatePlatformFees);

module.exports = router;
