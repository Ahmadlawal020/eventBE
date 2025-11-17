const express = require("express");
const router = express.Router();

const {
  handleCheckUser,
  handleSignup,
  handleLogin,
  handleLogout,
  handleRefreshToken,
  handleGoogleAuth,
} = require("../../controllers/user/auth.controller");

// 🔍 Check if user exists (by email)
router.post("/check", handleCheckUser);

// 📝 Signup
router.post("/signup", handleSignup);

// 🔑 Login
router.post("/login", handleLogin);

//google
router.post("/login", handleLogin);

// 🚪 Logout
router.post("/google", handleGoogleAuth);

// 🔄 Refresh token
router.post("/refresh", handleRefreshToken);

module.exports = router;
