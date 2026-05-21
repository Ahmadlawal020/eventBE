const express = require("express");
const router = express.Router();
const ticketDashboardController = require("../../controllers/user/ticketDashboard.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// Protect all routes
router.use(verifyJWT);

// GET /api/organiser/ticket-stats
router.get("/stats", ticketDashboardController.getOrganiserTicketStats);

// GET /api/organiser/ticket-stats/:eventId
router.get("/stats/:eventId", ticketDashboardController.getSingleEventTicketStats);

// GET /api/organiser/ticket-stats/:eventId/attendees
router.get("/stats/:eventId/attendees", ticketDashboardController.getEventAttendees);

module.exports = router;
