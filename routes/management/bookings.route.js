const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getBookings,
  getBookingDetail,
  updateBookingStatus,
} = require("../../controllers/management/bookings.controller");

router.get("/", verifyAdmin, getBookings);
router.get("/:type/:id", verifyAdmin, getBookingDetail);
router.patch("/:type/:id/status", verifyAdmin, updateBookingStatus);

module.exports = router;
