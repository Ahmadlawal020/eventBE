const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getPayments,
  getPaymentDetail,
  verifyPaymentReference,
} = require("../../controllers/management/payments.controller");

router.get("/", verifyAdmin, getPayments);
router.get("/verify/:reference", verifyAdmin, verifyPaymentReference);
router.get("/venue-payouts", verifyAdmin, async (req, res) => {
  try {
    const Payout = require("../../models/client/venuePayout.schema");
    const payouts = await Payout.find()
      .select("+destination")
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("organiser", "firstName surname email")
      .populate({
        path: "booking",
        select: "ticketNumber totalPrice subtotalPrice platformFeeAmount status paymentStatus eventCenter createdAt",
        populate: { path: "eventCenter", select: "venueName" },
      })
      .lean();
    const safePayouts = payouts.map((p) => {
      const acct = String(p.destination?.accountNumber || "");
      const maskedAccount = acct.length >= 4 ? `**** ${acct.slice(-4)}` : acct || "N/A";
      return {
        ...p,
        destination: p.destination
          ? {
              bankName: p.destination.bankName || p.destination.bankCode || "Bank Account",
              bankCode: p.destination.bankCode || "",
              accountName: p.destination.accountName || "",
              accountNumberMasked: maskedAccount,
            }
          : undefined,
      };
    });
    res.json({ success: true, data: safePayouts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Could not load venue payouts" });
  }
});
router.post("/venue-payouts/:id", verifyAdmin, async (req, res) => {
  try {
    if (!require("../../controllers/management/paymentExceptions.controller").allowed(req)) {
      return res.status(403).json({ success: false, message: "Finance access required" });
    }
    const mongoose = require("mongoose");
    const Payout = require("../../models/client/venuePayout.schema");
    const Booking = require("../../models/client/eventCenterBooking.schema");
    const Audit = require("../../models/management/adminAuditLog.schema");
    const { processVenuePayout } = require("../../services/venuePayout.service");
    const { id } = req.params;
    const { action, settlementReference, notes } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid payout ID" });
    }
    if (!["RETRY", "MARK_SETTLED", "CANCEL"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid payout action" });
    }
    const payout = await Payout.findById(id);
    if (!payout) {
      return res.status(404).json({ success: false, message: "Payout not found" });
    }
    const previousValue = { status: payout.status, lastError: payout.lastError, providerStatus: payout.providerStatus };
    if (action === "RETRY") {
      if (!["READY", "FAILED", "NEEDS_ATTENTION"].includes(payout.status)) {
        return res.status(409).json({ success: false, message: `Cannot retry a payout in ${payout.status} status` });
      }
      const booking = await Booking.findById(payout.booking).lean();
      if (!booking || !["CONFIRMED", "COMPLETED"].includes(booking.status) || booking.paymentStatus !== "COMPLETED" || booking.refund?.state) {
        return res.status(409).json({ success: false, message: "Associated booking is not eligible for payout" });
      }
      payout.status = "READY";
      payout.lastError = "";
      payout.leaseUntil = new Date(0);
      payout.leaseToken = undefined;
      if (["FAILED", "NEEDS_ATTENTION"].includes(previousValue.status)) {
        payout.reference = `venue-${payout.booking}-r${Date.now().toString(36)}`;
      }
      await payout.save();
      try {
        await processVenuePayout(payout._id);
      } catch (err) {
        console.error("[ADMIN RETRY VENUE PAYOUT]", err.message);
      }
    } else if (action === "MARK_SETTLED") {
      if (typeof settlementReference !== "string" || settlementReference.trim().length < 4) {
        return res.status(400).json({ success: false, message: "Provide a valid external settlement reference" });
      }
      if (payout.status === "CANCELLED") {
        return res.status(409).json({ success: false, message: "Cancelled payouts cannot be marked settled" });
      }
      payout.status = "SUCCESS";
      payout.providerStatus = `manual:${settlementReference.trim()}`;
      payout.lastError = "";
      await payout.save();
    } else if (action === "CANCEL") {
      if (payout.status === "SUCCESS") {
        return res.status(409).json({ success: false, message: "Settled payouts cannot be cancelled" });
      }
      if (["PREPARING", "SUBMITTING", "PENDING"].includes(payout.status)) {
        return res.status(409).json({ success: false, message: "Cannot cancel a payout currently in flight with the provider" });
      }
      payout.status = "CANCELLED";
      payout.lastError = typeof notes === "string" && notes.trim() ? notes.trim() : "Cancelled by finance administrator";
      await payout.save();
    }
    const updated = await Payout.findById(id).populate("organiser", "firstName surname email").lean();
    await Audit.create([{
      admin: req.user.id,
      action: `VENUE_PAYOUT_${action}`,
      targetType: "VenuePayout",
      targetId: payout._id,
      previousValue,
      newValue: { status: updated.status, lastError: updated.lastError, providerStatus: updated.providerStatus },
      metadata: { bookingId: payout.booking, amountMinor: payout.amountMinor, currency: payout.currency, settlementReference, notes },
    }]);
    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error("[ADMIN UPDATE VENUE PAYOUT]", error);
    return res.status(500).json({ success: false, message: "Could not update venue payout" });
  }
});
router.get("/exceptions", verifyAdmin, require("../../controllers/management/paymentExceptions.controller").list);
router.post("/exceptions/:id", verifyAdmin, require("../../controllers/management/paymentExceptions.controller").update);
router.get("/void-reviews", verifyAdmin, require("../../controllers/management/ticketVoidReviews.controller").list);
router.post("/void-reviews/:id", verifyAdmin, require("../../controllers/management/ticketVoidReviews.controller").update);
router.get("/operations", verifyAdmin, async (req, res) => {
  if (!require("../../controllers/management/paymentExceptions.controller").allowed(req)) return res.status(403).json({ message: "Finance access required" });
  try { res.json({ success: true, data: await require("../../services/eventOperations.service").getEventOperations() }); }
  catch { res.status(503).json({ message: "Could not load event worker health" }); }
});
router.get("/:id", verifyAdmin, getPaymentDetail);

module.exports = router;
