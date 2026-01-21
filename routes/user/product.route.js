const express = require("express");
const router = express.Router();

const {
  createTicket,
  getTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
} = require("../../controllers/user/product.controller");

const verifyJWT = require("../../middleware/verifyJWT");

// Protect create/update/delete with auth

// router.post("/", verifyJWT, createTicket); // protect creation
router.post("/", createTicket); // protect creation (toggle when ready)

router.get("/", getTickets);
router.get("/:id", getTicketById);

// router.put("/:id", verifyJWT, updateTicket); // optionally protect updates
router.patch("/:id", verifyJWT, updateTicket);

router.delete("/:id", verifyJWT, deleteTicket); // optionally protect deletes

module.exports = router;
