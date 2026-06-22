const express = require("express");
const router = express.Router();
const {
  initializePayment,
  verifyPayment,
} = require("../../controllers/user/payment.controller");
const verifyJWT = require("../../middleware/verifyJWT");
const generateLimiter = require("../../middleware/generateLimiter");

// Rate limit: 10 payment initializations per minute per IP
const paymentLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many payment requests. Please try again later.",
});

router.post("/initialize", verifyJWT, paymentLimiter, initializePayment);
router.get("/verify/:reference", verifyJWT, verifyPayment);

module.exports = router;
