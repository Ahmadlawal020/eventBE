const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getAdminOverview,
  getAdminAnalytics,
} = require("../../controllers/management/dashboard.controller");

router.get("/overview", verifyAdmin, getAdminOverview);
router.get("/analytics", verifyAdmin, getAdminAnalytics);

module.exports = router;
