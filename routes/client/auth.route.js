const express = require("express");
const router = express.Router();
const limits = require("../../middleware/eventSecurityLimits");
router.use(limits.auth);
const validateRequest = require("../../middleware/validateRequest");
const {
  signupSchema,
  loginSchema,
  checkUserSchema,
  refreshTokenSchema,
  googleAuthSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordChangeRequestSchema,
  updatePasswordSchema
} = require("../../utils/validationSchemas");

const {
  handleCheckUser,
  handleSignup,
  handleLogin,
  handleLogout,
  handleRefreshToken,
  handleGoogleAuth,
  handleRequestOTP,
  handleVerifyOTP,
  handleRequestPasswordOTP,
  handleUpdatePassword,
} = require("../../controllers/client/auth.controller");

// 🔍 Check if user exists (by email)
router.post("/check", validateRequest(checkUserSchema), handleCheckUser);

// 📝 Signup
router.post("/signup", limits.login, validateRequest(signupSchema), handleSignup);

// 🔑 Login
router.post("/login", limits.login, validateRequest(loginSchema), handleLogin);

// 🚪 Logout
router.post("/logout", handleLogout);

// 🔄 Refresh token
router.post("/refresh", validateRequest(refreshTokenSchema), handleRefreshToken);

// 🌐 Google Auth
router.post("/google", limits.login, validateRequest(googleAuthSchema), handleGoogleAuth);

// 📧 Request OTP
router.post("/otp/request", limits.otpSend, validateRequest(otpRequestSchema), handleRequestOTP);

// ✅ Verify OTP
router.post("/otp/verify", limits.otpVerify, validateRequest(otpVerifySchema), handleVerifyOTP);

// 🏠 Password Management
router.post("/password/request", limits.otpSend, validateRequest(passwordChangeRequestSchema), handleRequestPasswordOTP);
router.post("/password/update", limits.otpVerify, validateRequest(updatePasswordSchema), handleUpdatePassword);

module.exports = router;
