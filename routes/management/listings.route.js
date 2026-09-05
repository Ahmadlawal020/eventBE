const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getListings,
  getListingDetails,
  updateListingStatus,
  updateListing,
} = require("../../controllers/management/listings.controller");

router.get("/", verifyAdmin, getListings);
router.get("/:type/:id", verifyAdmin, getListingDetails);
router.patch("/:type/:id/status", verifyAdmin, updateListingStatus);
router.patch("/:type/:id", verifyAdmin, updateListing);

module.exports = router;
