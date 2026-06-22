const express = require("express");
const router = express.Router();
const analyticsController = require("../../controllers/user/analytics.controller");
const generateLimiter = require("../../middleware/generateLimiter");

// Rate limit: 30 tracking requests per minute per IP
const trackLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many tracking requests. Please try again later.",
});

// Track interaction (public, but rate-limited)
router.post("/track", trackLimiter, analyticsController.recordInteraction);

module.exports = router;
