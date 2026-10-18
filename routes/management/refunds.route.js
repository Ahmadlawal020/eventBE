const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getRefunds,
  getRefundDetail,
  assignDirectRefundCase,
  addDirectRefundCaseNote,
  resolveDirectRefundCase,
} = require("../../controllers/management/refunds.controller");

router.get("/", verifyAdmin, getRefunds);
router.get("/:id", verifyAdmin, getRefundDetail);
router.patch("/:id/direct-case/assign", verifyAdmin, assignDirectRefundCase);
router.post("/:id/direct-case/notes", verifyAdmin, addDirectRefundCaseNote);
router.patch("/:id/direct-case/resolve", verifyAdmin, resolveDirectRefundCase);

module.exports = router;
