const express = require("express");
const router = express.Router();
const listingsController = require("../../controllers/user/listings.controller");

router.get("/", listingsController.getListings);

module.exports = router;
