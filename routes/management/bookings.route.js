const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getBookings,
  getBookingDetail,
  updateBookingStatus,
  getVenueCalendar,
} = require("../../controllers/management/bookings.controller");

router.get("/calendar", verifyAdmin, getVenueCalendar);
router.get("/", verifyAdmin, getBookings);
router.get("/:type/:id", verifyAdmin, getBookingDetail);
router.patch("/:type/:id/status", verifyAdmin, updateBookingStatus);

module.exports = router;
