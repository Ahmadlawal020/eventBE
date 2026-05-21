const express = require("express");
const router = express.Router();
const listingDashboardController = require("../../controllers/user/listingDashboard.controller");
const verifyJWT = require("../../middleware/verifyJWT");

/**
 * 📊 Organiser Listing Dashboard Routes
 */

// Get aggregate stats for all listings
router.get("/stats", verifyJWT, listingDashboardController.getOrganiserListingStats);

// Get detailed stats for a single listing
router.get("/stats/:id", verifyJWT, listingDashboardController.getSingleListingStats);

module.exports = router;
