const express = require("express");
const router = express.Router();
const {
  initiateTransfer,
  acceptTransfer,
  declineTransfer,
  cancelTransfer,
  getPendingTransfers,
  getSentTransferRequests,
  getTransferHistory,
  getTransferRequestDetails,
} = require("../../controllers/user/ticketTransfer.controller");
const verifyJWT = require("../../middleware/verifyJWT");

router.use(verifyJWT);

// Transfer request lifecycle
router.post("/", initiateTransfer);
router.post("/:requestId/accept", acceptTransfer);
router.post("/:requestId/decline", declineTransfer);
router.delete("/:requestId", cancelTransfer);

// Pending transfers
router.get("/pending/received", getPendingTransfers);
router.get("/pending/sent", getSentTransferRequests);

// Request details
router.get("/request/:requestId", getTransferRequestDetails);

// Transfer history (audit trail on a ticket)
router.get("/:ticketId/history", getTransferHistory);

module.exports = router;
