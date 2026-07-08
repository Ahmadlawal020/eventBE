const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  initiateRefund,
  getRefunds,
  getRefundDetail,
} = require("../../controllers/admin/adminRefunds.controller");

router.post("/", verifyAdmin, initiateRefund);
router.get("/", verifyAdmin, getRefunds);
router.get("/:id", verifyAdmin, getRefundDetail);

module.exports = router;
