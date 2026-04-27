const express = require("express");
const router = express.Router();
const ticketController = require("../../controllers/user/ticket.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// ALL ROUTES ARE PROTECTED
router.use(verifyJWT);

router.get("/my-tickets", ticketController.getAllMyTickets);
router.get("/my-tickets/:id", ticketController.getTicketDetails);

module.exports = router;
