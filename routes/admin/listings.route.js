const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getListings,
  getListingDetails,
  updateListingStatus,
} = require("../../controllers/admin/adminListings.controller");

router.get("/", verifyAdmin, getListings);
router.get("/:type/:id", verifyAdmin, getListingDetails);
router.patch("/:type/:id/status", verifyAdmin, updateListingStatus);

module.exports = router;
