const express = require("express");
const router = express.Router();
const {
  createTicket,
  verifyPayment,
  getMyTickets,
  validateTicket,
  verifyTicket,
  getTicketById,
} = require("../../controllers/user/eventCenterTicket.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.post("/", verifyJWT, createTicket);
router.get("/my-tickets", verifyJWT, getMyTickets);
router.get("/verify/:reference", verifyJWT, verifyPayment);

// Entry control (organisers/staff)
router.post("/verify-ticket", verifyJWT, verifyTicket);
router.post("/validate", verifyJWT, validateTicket);

// Single ticket by ID (must be LAST — /:id is a catch-all param)
router.get("/:id", verifyJWT, getTicketById);

module.exports = router;
