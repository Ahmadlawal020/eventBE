const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getTransfers,
  getTransferDetail,
} = require("../../controllers/admin/adminTransfers.controller");

router.get("/", verifyAdmin, getTransfers);
router.get("/:id", verifyAdmin, getTransferDetail);

module.exports = router;
