const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const {
  getUserReferralStats,
  applyUserReferralCode,
} = require("../../controllers/user/referral.controller");

router.use(verifyJWT);

router.get("/stats", getUserReferralStats);
router.post("/apply", applyUserReferralCode);

module.exports = router;
