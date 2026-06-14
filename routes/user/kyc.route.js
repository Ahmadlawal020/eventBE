const express = require("express");
const router = express.Router();
const { submitKyc, getKycStatus, cancelKyc } = require("../../controllers/user/kyc.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// @route   POST /api/kyc/submit
// @desc    Submit identity verification documents
// @access  Private
router.post("/submit", verifyJWT, submitKyc);

// @route   GET /api/kyc/status
// @desc    Get current KYC verification status
// @access  Private
router.get("/status", verifyJWT, getKycStatus);

// @route   DELETE /api/kyc/cancel
// @desc    Cancel active identity verification request
// @access  Private
router.delete("/cancel", verifyJWT, cancelKyc);

module.exports = router;
