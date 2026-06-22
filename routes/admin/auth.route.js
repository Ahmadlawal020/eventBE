const express = require("express");
const router = express.Router();
const {
  handleAdminLogin,
  handleAdminRefreshToken,
  handleAdminLogout,
  registerAdmin,
  verifyInviteToken,
  acceptInvite,
} = require("../../controllers/admin/adminAuth.controller");
const generateLimiter = require("../../middleware/generateLimiter");

// Rate limit: 5 login attempts per minute per IP
const adminLoginLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many admin login attempts. Please try again after 60 seconds.",
});

router.post("/login", adminLoginLimiter, handleAdminLogin);
router.post("/refresh", handleAdminRefreshToken);
router.post("/logout", handleAdminLogout);
router.post("/register", registerAdmin);
router.get("/invite/verify", verifyInviteToken);
router.post("/invite/accept", acceptInvite);

module.exports = router;
