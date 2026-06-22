const express = require("express");
const router = express.Router();
const { handlePaymentWebhook } = require("../../controllers/user/paymentWebhook.controller");

// No JWT verification — webhook signature is validated by the adapter
router.post("/", handlePaymentWebhook);

module.exports = router;
