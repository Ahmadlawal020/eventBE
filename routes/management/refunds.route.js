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

const operations = require("../../controllers/management/refundOperations.controller");
router.get("/operations", verifyAdmin, operations.operations);
router.get("/operations/failed-notices", verifyAdmin, operations.failedNotices);
router.post("/operations/failed-notices/:noticeId/retry", verifyAdmin, operations.retryNotice);
router.get("/", verifyAdmin, getRefunds);
router.patch("/:id/direct-case/recover", verifyAdmin, require("../../controllers/client/refundSupport.controller").recoverUnpaidRefund);
router.get("/:id", verifyAdmin, getRefundDetail);
router.patch("/:id/direct-case/assign", verifyAdmin, assignDirectRefundCase);
router.post("/:id/direct-case/notes", verifyAdmin, addDirectRefundCaseNote);
router.patch("/:id/direct-case/resolve", verifyAdmin, resolveDirectRefundCase);

module.exports = router;
