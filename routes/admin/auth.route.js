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

router.post("/login", handleAdminLogin);
router.post("/refresh", handleAdminRefreshToken);
router.post("/logout", handleAdminLogout);
router.post("/register", registerAdmin); // Built-in auth/bootstrap logic inside controller
router.get("/invite/verify", verifyInviteToken);
router.post("/invite/accept", acceptInvite);

module.exports = router;
