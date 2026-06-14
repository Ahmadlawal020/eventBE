const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getPayments,
  getPaymentDetail,
  verifyPaymentReference,
} = require("../../controllers/admin/adminPayments.controller");

router.get("/", verifyAdmin, getPayments);
router.get("/verify/:reference", verifyAdmin, verifyPaymentReference);
router.get("/:id", verifyAdmin, getPaymentDetail);

module.exports = router;
