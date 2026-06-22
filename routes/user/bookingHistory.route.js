const express = require("express");
const router = express.Router();
const {
  getBookingHistory,
  getAllBookingHistory,
  createHistoryEntry,
  getUnifiedBookings,
  getBookingActivity,
  getBookingFullDetails,
} = require("../../controllers/user/bookingHistory.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.get("/bookings", verifyJWT, getUnifiedBookings);
router.get("/all", verifyJWT, getAllBookingHistory);
router.get("/booking/:bookingId/activity", verifyJWT, getBookingActivity);
router.get("/booking/:bookingId/details", verifyJWT, getBookingFullDetails);
router.get("/:eventCenterId", verifyJWT, getBookingHistory);
router.post("/", verifyJWT, createHistoryEntry);

module.exports = router;
