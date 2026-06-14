const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getAdminOverview,
  getAdminAnalytics,
} = require("../../controllers/admin/adminDashboard.controller");

router.get("/overview", verifyAdmin, getAdminOverview);
router.get("/analytics", verifyAdmin, getAdminAnalytics);

module.exports = router;
