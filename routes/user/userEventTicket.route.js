const express = require("express");
const router = express.Router();
const {
  getMyTickets,
  getTicketDetails,
  validateTicket,
  verifyTicket,
  getEventCheckInStats,
} = require("../../controllers/user/userEventTicket.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// All routes here are protected
router.use(verifyJWT);

// User-facing
router.get("/my-tickets", getMyTickets);
router.get("/:id", getTicketDetails);

// Entry control (organisers/staff)
router.post("/verify", verifyTicket);
router.post("/validate", validateTicket);

// Analytics (organisers)
router.get("/stats/:eventId", getEventCheckInStats);

module.exports = router;
