const express = require("express");
const router = express.Router();

const {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
} = require("../../controllers/user/eventTicketType.controller");

const {
  createBooking,
  verifyBooking,
} = require("../../controllers/user/eventBooking.controller");

const verifyJWT = require("../../middleware/verifyJWT");

// --- BUYER ROUTES ---
router.post("/purchase", verifyJWT, createBooking);
router.get("/verify/:reference", verifyBooking);

// --- ORGANISER ROUTES ---
router.post("/", verifyJWT, createTicket);

router.get("/", getTickets);
router.get("/:id", getTicketById);

router.patch("/:id", verifyJWT, updateTicket);

router.delete("/:id", verifyJWT, deleteTicket);

module.exports = router;
