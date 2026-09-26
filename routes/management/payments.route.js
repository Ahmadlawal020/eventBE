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
router.get("/:id", verifyAdmin, getPaymentDetail);

module.exports = router;
