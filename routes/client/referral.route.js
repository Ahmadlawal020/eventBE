const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const {
  getUserReferralStats,
  applyUserReferralCode,
} = require("../../controllers/client/referral.controller");

router.use(verifyJWT);

router.get("/stats", getUserReferralStats);
router.post("/apply", applyUserReferralCode);

module.exports = router;
