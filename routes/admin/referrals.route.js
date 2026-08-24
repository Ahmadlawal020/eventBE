const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getAdminReferralStats,
  getAdminReferralEarnings,
} = require("../../controllers/admin/adminReferrals.controller");

router.get("/stats", verifyAdmin, getAdminReferralStats);
router.get("/earnings", verifyAdmin, getAdminReferralEarnings);

module.exports = router;
