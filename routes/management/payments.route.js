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
router.get("/venue-payouts", verifyAdmin, async (req,res) => {
  try {
    const Payout=require("../../models/client/venuePayout.schema");
    const payouts=await Payout.find().sort({createdAt:-1}).limit(100).populate("organiser","firstName surname email");
    res.json({success:true,data:payouts});
  } catch(error){res.status(500).json({success:false,message:"Could not load venue payouts"});}
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
