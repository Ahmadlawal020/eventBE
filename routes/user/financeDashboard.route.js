const express = require("express");
const router = express.Router();
const financeDashboardController = require("../../controllers/user/financeDashboard.controller");
const verifyJWT = require("../../middleware/verifyJWT");

/**
 * 📅 Organiser Finance Dashboard Routes
 */

router.get("/stats", verifyJWT, financeDashboardController.getFinanceStats);
router.get("/banks", verifyJWT, financeDashboardController.getBanksList);
router.post("/verify-account", verifyJWT, financeDashboardController.verifyAccount);
router.post("/verify-password", verifyJWT, financeDashboardController.verifyPassword);
router.post("/setup-subaccount", verifyJWT, financeDashboardController.setupSubaccount);
router.delete("/remove-subaccount", verifyJWT, financeDashboardController.removeSubaccount);

module.exports = router;
