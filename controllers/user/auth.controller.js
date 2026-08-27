const User = require("../../models/user/user.schema");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const asyncHandler = require("express-async-handler");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateTokens = (user) => {
  const { _id: id, email, roles } = user;

  const accessToken = jwt.sign(
    { UserInfo: { id, email, roles } },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );

  const refreshToken = jwt.sign(
    { id, email },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};

// 🔍 Check if user exists (before signup)
const handleCheckUser = asyncHandler(async (req, res) => {
  let { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required" });

  email = email.trim().toLowerCase();

  const foundUser = await User.findOne({ email }).exec();
  return res.json({
    success: true,
    message: "Check complete",
    data: { exists: !!foundUser },
  });
});

const { generateReferralCode } = require("../../services/referral.service");

// authController.js - Update handleSignup
const handleSignup = asyncHandler(async (req, res) => {
  let {
    firstName,
    surname,
    email,
    password,
    dob,
    googleId,
    googleSignupToken,
    authProvider = "local",
    referralCode: incomingReferralCode,
  } = req.body;

  email = email.trim().toLowerCase();

  // A client must not be able to create a Google account by merely supplying a
  // Google subject ID. The short-lived token is issued only after Google ID
  // token verification in handleGoogleAuth.
  if (authProvider === "google") {
    try {
      const verifiedGoogleSignup = jwt.verify(
        googleSignupToken,
        process.env.ACCESS_TOKEN_SECRET
      );
      if (
        verifiedGoogleSignup.type !== "google_signup" ||
        verifiedGoogleSignup.email !== email ||
        verifiedGoogleSignup.googleId !== googleId
      ) {
        return res.status(401).json({ success: false, message: "Invalid Google signup session" });
      }
    } catch {
      return res.status(401).json({ success: false, message: "Google signup session expired. Please sign in again." });
    }
  }

  const existingUser = await User.findOne({ email }).exec();
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "User already exists",
    });
  }

  let hashedPassword;
  if (authProvider === "local" && password) {
    hashedPassword = await bcrypt.hash(password, 10);
  }

  const generatedCode = await generateReferralCode({ firstName, surname });

  const userData = {
    firstName,
    surname,
    email,
    dob,
    password: hashedPassword,
    authProvider,
    isEmailVerified: true,
    emailVerifiedAt: new Date(),
    referralCode: generatedCode,
  };

  if (googleId) {
    userData.googleId = googleId;
  }

  // If user provided a referral code, link referrer
  if (incomingReferralCode && typeof incomingReferralCode === "string") {
    const cleanCode = incomingReferralCode.trim().toUpperCase();
    const referrer = await User.findOne({ referralCode: cleanCode }).select("_id").lean();
    if (referrer) {
      userData.referredBy = referrer._id;
      userData.referredAt = new Date();
    }
  }

  const newUser = new User(userData);

  const { accessToken, refreshToken } = generateTokens(newUser);
  newUser.refreshToken = refreshToken;
  await newUser.save();

  res.status(201).json({
    success: true,
    message: "Signup successful",
    data: {
      user: {
        id: newUser._id,
        email: newUser.email,
        firstName: newUser.firstName,
        surname: newUser.surname,
        roles: newUser.roles,
        authProvider: newUser.authProvider,
        profilePicture: newUser.profilePicture,
        referralCode: newUser.referralCode,
        isEmailVerified: newUser.isEmailVerified,
        isPhoneVerified: newUser.isPhoneVerified,
        isIdentityVerified: newUser.isIdentityVerified,
        phoneVerifiedAt: newUser.phoneVerifiedAt,
        emailVerifiedAt: newUser.emailVerifiedAt,
        hasPassword: !!newUser.password,
      },
      accessToken,
      refreshToken,
      signupCompleted: true,
    },
  });
});

// 🔑 Login
const handleLogin = asyncHandler(async (req, res) => {
  let { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

  email = email.trim().toLowerCase();

  const foundUser = await User.findOne({ email }).exec();
  if (!foundUser) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid email or password" });
  }

  // Handle Google users who try to login via password
  if (foundUser.authProvider === 'google' && !foundUser.password) {
    return res
      .status(400)
      .json({ success: false, message: "Please login with Google" });
  }

  const match = await bcrypt.compare(password, foundUser.password);
  if (!match)
    return res
      .status(401)
      .json({ success: false, message: "Invalid email or password" });

  const { accessToken, refreshToken } = generateTokens(foundUser);
  foundUser.refreshToken = refreshToken;
  await foundUser.save();

  res.json({
    success: true,
    message: "Login successful",
    data: {
      user: {
        id: foundUser._id,
        email: foundUser.email,
        firstName: foundUser.firstName,
        surname: foundUser.surname,
        roles: foundUser.roles,
        authProvider: foundUser.authProvider,
        profilePicture: foundUser.profilePicture,
        isEmailVerified: foundUser.isEmailVerified,
        isPhoneVerified: foundUser.isPhoneVerified,
        isIdentityVerified: foundUser.isIdentityVerified,
        phoneVerifiedAt: foundUser.phoneVerifiedAt,
        emailVerifiedAt: foundUser.emailVerifiedAt,
        hasPassword: !!foundUser.password,
      },
      accessToken,
      refreshToken,
    },
  });
});

//  Logout
const handleLogout = asyncHandler(async (req, res) => {
  const cookies = req.cookies;
  const { refreshToken } = req.body;

  if (!refreshToken) return res.sendStatus(204); // No content

  const foundUser = await User.findOne({ refreshToken }).exec();
  if (!foundUser) {
    return res.sendStatus(204);
  }

  // Delete refreshToken in db
  foundUser.refreshToken = '';
  if (req.body.pushToken && Array.isArray(foundUser.pushTokens)) {
    foundUser.pushTokens = foundUser.pushTokens.filter((t) => t.token !== req.body.pushToken);
  }
  await foundUser.save();

  res.status(200).json({ success: true, message: "Logged out" });
});

//  Refresh token
const handleRefreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  // Validation handled by middleware

  const foundUser = await User.findOne({ refreshToken }).exec();
  if (!foundUser)
    return res.status(403).json({ success: false, message: "Forbidden" });

  jwt.verify(
    refreshToken,
    process.env.REFRESH_TOKEN_SECRET,
    async (err, decoded) => {
      if (err || foundUser.email !== decoded.email)
        return res.status(403).json({ success: false, message: "Forbidden" });

      const { accessToken, refreshToken: newRefresh } =
        generateTokens(foundUser);

      foundUser.refreshToken = newRefresh;
      await foundUser.save();

      res.json({
        success: true,
        message: "Token refreshed",
        data: {
          user: {
            id: foundUser._id,
            email: foundUser.email,
            firstName: foundUser.firstName,
            surname: foundUser.surname,
            roles: foundUser.roles,
            authProvider: foundUser.authProvider,
            profilePicture: foundUser.profilePicture,
            isEmailVerified: foundUser.isEmailVerified,
            isPhoneVerified: foundUser.isPhoneVerified,
            isIdentityVerified: foundUser.isIdentityVerified,
            phoneVerifiedAt: foundUser.phoneVerifiedAt,
            emailVerifiedAt: foundUser.emailVerifiedAt,
            hasPassword: !!foundUser.password,
          },
          accessToken,
          refreshToken: newRefresh,
        },
      });
    }
  );
});

const handleGoogleAuth = asyncHandler(async (req, res) => {
  const { idToken, code, codeVerifier, redirectUri } = req.body;
  // Input validation handled by middleware

  // Validate environment variables
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.error("Missing Google OAuth environment variables");
    return res.status(500).json({
      success: false,
      message: "Server configuration error",
    });
  }

  let tokenToVerify = idToken;

  // Web retains the browser PKCE flow. Native applications submit the ID token
  // returned by the Google SDK, so no client secret is exposed or required there.
  if (!tokenToVerify) {
    if (!process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ success: false, message: "Server configuration error" });
    }

    const targetRedirectUri = redirectUri || process.env.GOOGLE_REDIRECT_URI;
    const { tokens } = await client.getToken({
      code,
      codeVerifier,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: targetRedirectUri,
    });
    tokenToVerify = tokens.id_token;
  }

  if (!tokenToVerify) {
    return res.status(400).json({ success: false, message: "No ID token received from Google" });
  }

  // Verify the ID token
  const ticket = await client.verifyIdToken({
    idToken: tokenToVerify,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const {
    email,
    given_name: firstName,
    family_name: surname,
    sub: googleId,
    picture,
  } = payload;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Google account has no email",
    });
  }

  // Check for existing user by email or googleId
  let user = await User.findOne({
    $or: [{ email }, { googleId }],
  }).exec();

  if (user) {
    // ✅ EXISTING USER: Generate tokens and log them in

    // Update googleId if missing/changed (merging accounts if email matches)
    if (!user.googleId) {
      user.googleId = googleId;
      user.authProvider = 'google'; // convert to google auth or hybrid
    }

    const { accessToken, refreshToken } = generateTokens(user);

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save();

    return res.json({
      success: true,
      message: "Google authentication successful",
      data: {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          surname: user.surname,
          roles: user.roles,
          authProvider: user.authProvider,
          profilePicture: user.profilePicture,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified,
          isIdentityVerified: user.isIdentityVerified,
          phoneVerifiedAt: user.phoneVerifiedAt,
          emailVerifiedAt: user.emailVerifiedAt,
          hasPassword: !!user.password,
        },
        accessToken,
        refreshToken,
      },
    });
  } else {
    // ❌ NEW USER: Return user data for signup completion
    console.log("New Google user - redirecting to signup form");

    return res.json({
      success: true,
      message: "Google user needs to complete signup",
      data: {
        needsSignup: true,
        user: {
          email,
          firstName: firstName || "",
          surname: surname || "",
          profilePicture: picture,
          googleId: googleId,
          authProvider: 'google',
          signupToken: jwt.sign(
            { type: "google_signup", email, googleId },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "10m" }
          ),
        },
      },
    });
  }
});

const otpService = require("../../services/otp.service");

// 📧 Request OTP
const handleRequestOTP = asyncHandler(async (req, res) => {
  const { identifier, type } = req.body;

  try {
    await otpService.requestOTP(identifier, type);
    res.json({
      success: true,
      message: `OTP sent to ${identifier}`,
    });
  } catch (error) {
    res.status(400);
    throw error;
  }
});

// ✅ Verify OTP
const handleVerifyOTP = asyncHandler(async (req, res) => {
  const { identifier, code, type } = req.body;

  const result = await otpService.verifyOTP(identifier, code, type);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message,
    });
  }

  // Update user record depending on type
  let updatedUser = null;
  if (type === "email" || type === "phone") {
    const updateQuery = type === "email" ? { email: identifier } : { phoneNumber: identifier };
    const updateField = type === "email"
      ? { isEmailVerified: true, emailVerifiedAt: new Date() }
      : { phoneNumber: identifier, isPhoneVerified: true, phoneVerifiedAt: new Date() };

    updatedUser = await User.findOneAndUpdate(
      updateQuery,
      updateField,
      { new: true }
    );

    // Auto-sync event centers and events status on verification
    if (updatedUser) {
      const { syncUserEventCenters } = require("./eventCenter.controller");
      const { syncUserEvents } = require("./event.controller");
      await syncUserEventCenters(updatedUser._id);
      await syncUserEvents(updatedUser._id);
    }
  }

  res.json({
    success: true,
    message: "Verification successful",
    user: updatedUser,
  });
});

// 🏠 Password Management
const handleRequestPasswordOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required" });

  await otpService.requestOTP(email, "password_change");

  res.json({
    success: true,
    message: `Verification code sent to ${email}`,
  });
});

const handleUpdatePassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  const result = await otpService.verifyOTP(email, code, "password_change");
  if (!result.success) {
    return res.status(400).json({ success: false, message: result.message });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  const user = await User.findOneAndUpdate(
    { email },
    { password: hashedPassword },
    { new: true }
  ).exec();

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  res.json({
    success: true,
    message: "Password updated successfully",
  });
});

module.exports = {
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
};
