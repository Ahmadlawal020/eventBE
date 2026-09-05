const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getTransfers,
  getTransferDetail,
} = require("../../controllers/management/transfers.controller");

router.get("/", verifyAdmin, getTransfers);
router.get("/:id", verifyAdmin, getTransferDetail);

module.exports = router;
