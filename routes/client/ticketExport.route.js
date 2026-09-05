const express = require("express");
const router = express.Router();
const { generateTicketPDF } = require("../../controllers/client/ticketExport.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.use(verifyJWT);

router.get("/:ticketId/pdf", generateTicketPDF);

module.exports = router;
