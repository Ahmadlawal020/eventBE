const express = require("express");
const router = express.Router();

const {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
} = require("../../controllers/client/eventTicketType.controller");

const {
  createBooking,
  verifyBooking,
} = require("../../controllers/client/eventBooking.controller");

const optionalJWT = require("../../middleware/optionalJWT");
const verifyJWT = require("../../middleware/verifyJWT");

// --- BUYER ROUTES ---
router.post("/purchase", verifyJWT, createBooking);
router.get("/verify/:reference", verifyJWT, verifyBooking);

// --- ORGANISER ROUTES ---
router.post("/", verifyJWT, createTicket);

router.get("/", optionalJWT, getTickets);
router.get("/:id", optionalJWT, getTicketById);

router.patch("/:id", verifyJWT, updateTicket);

router.delete("/:id", verifyJWT, deleteTicket);

module.exports = router;
