const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const { getTickets, getTicketDetail } = require("../../controllers/management/tickets.controller");

router.get("/", verifyAdmin, getTickets);
router.get("/:id", verifyAdmin, getTicketDetail);

module.exports = router;
