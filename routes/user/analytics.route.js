const express = require("express");
const router = express.Router();
const analyticsController = require("../../controllers/user/analytics.controller");

// Track interaction (public or authenticated)
router.post("/track", analyticsController.recordInteraction);

module.exports = router;
