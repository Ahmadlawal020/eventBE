const express = require("express");
const router = express.Router();
const bookingDashboardController = require("../../controllers/user/bookingDashboard.controller");
const verifyJWT = require("../../middleware/verifyJWT");

/**
 * 📅 Organiser Booking Dashboard Routes
 */

router.get("/stats", verifyJWT, bookingDashboardController.getOrganiserBookingStats);
router.get("/stats/:venueId", verifyJWT, bookingDashboardController.getSingleVenueBookingStats);

module.exports = router;
