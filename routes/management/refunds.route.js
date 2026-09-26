const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getRefunds,
  getRefundDetail,
} = require("../../controllers/management/refunds.controller");

router.get("/", verifyAdmin, getRefunds);
router.get("/:id", verifyAdmin, getRefundDetail);

module.exports = router;
