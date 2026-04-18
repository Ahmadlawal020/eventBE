const express = require("express");
const router = express.Router();
const ticketController = require("../../controllers/user/ticket.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// ALL ROUTES ARE PROTECTED
router.use(verifyJWT);

router.get("/my-tickets", ticketController.getAllMyTickets);

module.exports = router;
