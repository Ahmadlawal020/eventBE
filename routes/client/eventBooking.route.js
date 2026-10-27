const express = require("express");
const router = express.Router();
const {
  getBookingPaymentStatus,
  createBooking,
  quoteBooking,
  verifyBooking,
  getMyBookings
} = require("../../controllers/client/eventBooking.controller");
const verifyJWT = require("../../middleware/verifyJWT");

const limits = require("../../middleware/eventSecurityLimits");
router.post("/quote", limits.quote, quoteBooking);
router.post("/", verifyJWT, limits.checkout, createBooking);
router.get("/my-bookings", verifyJWT, getMyBookings);
router.get("/status/:reference", verifyJWT, getBookingPaymentStatus);
router.get("/verify/:reference", verifyJWT, verifyBooking);

module.exports = router;
