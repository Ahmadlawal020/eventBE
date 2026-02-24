const express = require("express");
const router = express.Router();
const validateRequest = require("../../middleware/validateRequest");
const { 
  signupSchema, 
  loginSchema, 
  checkUserSchema, 
  refreshTokenSchema, 
  googleAuthSchema 
} = require("../../utils/validationSchemas");

const {
  handleCheckUser,
  handleSignup,
  handleLogin,
  handleLogout,
  handleRefreshToken,
  handleGoogleAuth,
} = require("../../controllers/user/auth.controller");

// 🔍 Check if user exists (by email)
router.post("/check", validateRequest(checkUserSchema), handleCheckUser);

// 📝 Signup
router.post("/signup", validateRequest(signupSchema), handleSignup);

// 🔑 Login
router.post("/login", validateRequest(loginSchema), handleLogin);

// 🚪 Logout
router.post("/logout", handleLogout);

// 🔄 Refresh token
router.post("/refresh", validateRequest(refreshTokenSchema), handleRefreshToken);

// 🌐 Google Auth
router.post("/google", validateRequest(googleAuthSchema), handleGoogleAuth);

module.exports = router;
