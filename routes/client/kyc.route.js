const express = require("express");
const router = express.Router();
const { submitKyc, getKycStatus, cancelKyc } = require("../../controllers/client/kyc.controller");
const verifyJWT = require("../../middleware/verifyJWT");

const { createSelfieChallenge } = require("../../controllers/client/selfieChallenge.controller");
const { rateLimit } = require("express-rate-limit");
const challengeLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
router.post("/selfie-challenge", verifyJWT, challengeLimit, createSelfieChallenge);
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
