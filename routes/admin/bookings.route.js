const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getBookings,
  getBookingDetail,
  updateBookingStatus,
} = require("../../controllers/admin/adminBookings.controller");

router.get("/", verifyAdmin, getBookings);
router.get("/:type/:id", verifyAdmin, getBookingDetail);
router.patch("/:type/:id/status", verifyAdmin, updateBookingStatus);

module.exports = router;
