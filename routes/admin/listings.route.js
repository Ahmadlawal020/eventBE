const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getListings,
  getListingDetails,
  updateListingStatus,
  updateListing,
} = require("../../controllers/admin/adminListings.controller");

router.get("/", verifyAdmin, getListings);
router.get("/:type/:id", verifyAdmin, getListingDetails);
router.patch("/:type/:id/status", verifyAdmin, updateListingStatus);
router.patch("/:type/:id", verifyAdmin, updateListing);

module.exports = router;
