const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const { getTickets, getTicketDetail } = require("../../controllers/admin/adminTickets.controller");

router.get("/", verifyAdmin, getTickets);
router.get("/:id", verifyAdmin, getTicketDetail);

module.exports = router;
