const express = require("express");
const router = express.Router();
const {
  initializePayment,
  verifyPayment,
} = require("../../controllers/user/payment.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.post("/initialize", verifyJWT, initializePayment);
router.get("/verify/:reference", verifyJWT, verifyPayment);

module.exports = router;
