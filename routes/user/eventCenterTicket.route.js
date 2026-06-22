const express = require("express");
const router = express.Router();
const {
  createTicket,
  verifyPayment,
  getMyTickets,
  validateTicket,
  verifyTicket,
  getTicketById,
  acceptBooking,
  declineBooking,
} = require("../../controllers/user/eventCenterTicket.controller");
const verifyJWT = require("../../middleware/verifyJWT");
const generateLimiter = require("../../middleware/generateLimiter");

// Rate limit: 30 booking creations per minute per IP
const ticketCreateLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many booking requests. Please try again later.",
});

// Rate limit: 60 scans per minute per IP (scanning can be bursty at door)
const ticketScanLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many scan requests. Please try again later.",
});

router.post("/", verifyJWT, ticketCreateLimiter, createTicket);
router.get("/my-tickets", verifyJWT, getMyTickets);
router.get("/verify/:reference", verifyJWT, verifyPayment);

// Entry control (organisers/staff)
router.post("/verify-ticket", verifyJWT, ticketScanLimiter, verifyTicket);
router.post("/validate", verifyJWT, ticketScanLimiter, validateTicket);

// Review booking actions (organisers)
router.post("/:id/accept", verifyJWT, acceptBooking);
router.post("/:id/decline", verifyJWT, declineBooking);

// Single ticket by ID (must be LAST — /:id is a catch-all param)
router.get("/:id", verifyJWT, getTicketById);

module.exports = router;
