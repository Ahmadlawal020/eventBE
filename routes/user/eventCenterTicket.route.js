const express = require("express");
const router = express.Router();
const {
  createTicket,
  verifyPayment,
  getMyTickets
} = require("../../controllers/user/eventCenterTicket.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.post("/", verifyJWT, createTicket);
router.get("/my-tickets", verifyJWT, getMyTickets);
router.get("/verify/:reference", verifyJWT, verifyPayment);

module.exports = router;
