const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getAdminReferralStats,
  getAdminReferralEarnings,
} = require("../../controllers/management/referrals.controller");

router.get("/stats", verifyAdmin, getAdminReferralStats);
router.get("/earnings", verifyAdmin, getAdminReferralEarnings);

const policies = require("../../controllers/management/referralPolicy.controller");
const canManage = (req,res,next) => {
  if (!req.user.roles.some(role => ["admin", "super_admin", "finance_admin"].includes(role))) {
    return res.status(403).json({ success: false, message: "Finance or full administrator access required" });
  }
  next();
};
router.get("/policies", verifyAdmin, policies.listPolicies);
router.get("/users", verifyAdmin, canManage, policies.searchUsers);
router.put("/policies/:key", verifyAdmin, canManage, policies.updatePolicy);
router.post("/groups", verifyAdmin, canManage, policies.createGroup);
router.post("/adjustments/preview", verifyAdmin, canManage, policies.previewRates);
router.post("/adjustments/:id/apply", verifyAdmin, canManage, policies.applyRates);
module.exports = router;
