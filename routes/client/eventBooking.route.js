const express = require("express");
const router = express.Router();
const {
  createBooking,
  quoteBooking,
  verifyBooking,
  getMyBookings
} = require("../../controllers/client/eventBooking.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.post("/quote", quoteBooking);
router.post("/", verifyJWT, createBooking);
router.get("/my-bookings", verifyJWT, getMyBookings);
router.get("/verify/:reference", verifyJWT, verifyBooking);

module.exports = router;
