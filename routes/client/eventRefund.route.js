const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const controller = require("../../controllers/client/eventLifecycle.controller");

router.use(verifyJWT);
router.param("refundId", (req, res, next, value) => {
  if (!require("mongoose").Types.ObjectId.isValid(value)) return res.status(400).json({ success: false, message: "Invalid refund ID." });
  next();
});
const safe = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(error => {
  console.error("[EVENT REFUND]", error.message);
  const status = ["CastError", "ValidationError"].includes(error.name) ? 400 : 500;
  res.status(status).json({ success: false, message: status === 400 ? "Invalid refund details." : "Could not update refund. Please try again." });
});
router.get("/mine", safe(controller.getMyRefunds));
const receiptController = require("../../controllers/client/eventRefundReceipt.controller");
router.get("/:refundId/receipt", receiptController.getReceipt);
router.post("/:refundId/receipt/prepare", receiptController.prepareReceiptUpload);
router.post("/:refundId/receipt/complete", receiptController.completeReceiptUpload);
router.post("/:refundId/receipt", (req, res, next) => {
  if (!req.is("text/plain")) return res.status(415).json({ success: false, message: "Receipt upload must contain the image as base64 text." });
  express.text({ type: "text/plain", limit: "7mb" })(req, res, error => {
    if (error) return res.status(error.status === 413 ? 413 : 400).json({ success: false,
      message: error.status === 413 ? "Receipt image is too large. Choose an image under 5 MB." : "Could not read the receipt upload. Select the image again." });
    next();
  });
}, receiptController.uploadReceipt);
router.post("/:refundId/bank-details", safe(controller.submitBankDetails));
router.post("/:refundId/confirm", safe(controller.confirmRefund));
router.post("/:refundId/dispute", safe(controller.disputeRefund));
router.post("/:refundId/mark-paid", safe(controller.markRefundPaid));

module.exports = router;
