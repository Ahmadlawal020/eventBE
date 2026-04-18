const express = require("express");
const router = express.Router();
const {
  createBooking,
  verifyBooking,
  getMyBookings
} = require("../../controllers/user/eventBooking.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.post("/", verifyJWT, createBooking);
router.get("/my-bookings", verifyJWT, getMyBookings);
router.get("/verify/:reference", verifyJWT, verifyBooking);

module.exports = router;
