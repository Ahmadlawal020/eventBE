const express = require("express");
const router = express.Router();
const organiserListingsController = require("../../controllers/client/organiserListings.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.get("/", verifyJWT, organiserListingsController.getOrganiserListings);

module.exports = router;
