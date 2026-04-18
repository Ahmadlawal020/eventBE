const express = require("express");
const router = express.Router();
const {
  getMyTickets,
  getTicketDetails,
} = require("../../controllers/user/userEventTicket.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// All routes here are protected
router.use(verifyJWT);

router.get("/my-tickets", getMyTickets);
router.get("/:id", getTicketDetails);

module.exports = router;
