const User = require("../../models/user/user.schema");
// const bcrypt = require("bcryptjs");
const bcrypt = require("bcrypt"); // use bcrypt instead of bcryptjs
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

// Initialize OAuth2Client with proper credentials
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

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
const handleCheckUser = async (req, res) => {
  const { email } = req.body;
  if (!email)
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });

  try {
    const foundUser = await User.findOne({ email }).exec();
    return res.json({
      success: true,
      message: "Check complete",
      data: { exists: !!foundUser },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// authController.js - Update handleSignup
const handleSignup = async (req, res) => {
  const {
    firstName,
    surname,
    email,
    password,
    dob,
    googleId,
    authProvider = "local",
  } = req.body;

  // Validate required fields based on auth provider
  if (!firstName || !surname || !email || !dob) {
    return res.status(400).json({
      success: false,
      message: "All fields are required",
    });
  }

  // Password is only required for local auth
  if (authProvider === "local" && !password) {
    return res.status(400).json({
      success: false,
      message: "Password is required for email signup",
    });
  }

  try {
    const existingUser = await User.findOne({ email }).exec();
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    let hashedPassword;
    if (authProvider === "local") {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const newUser = new User({
      firstName,
      surname,
      email,
      dob,
      password: hashedPassword,
      googleId: googleId || null,
      authProvider,
    });

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
        },
        accessToken,
        refreshToken,
        // Add explicit flag for frontend
        signupCompleted: true,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
// 🔑 Login
const handleLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  }

  try {
    const foundUser = await User.findOne({ email }).exec();
    if (!foundUser) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
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
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 🚪 Logout
const handleLogout = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.json({ success: true, message: "Logged out" });

  try {
    const foundUser = await User.findOne({ refreshToken }).exec();
    if (!foundUser) return res.json({ success: true, message: "Logged out" });

    foundUser.refreshToken = "";
    await foundUser.save();

    res.json({ success: true, message: "Logged out" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 🔄 Refresh token
const handleRefreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
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
            },
            accessToken,
            refreshToken: newRefresh,
          },
        });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const handleGoogleAuth = async (req, res) => {
  const { code, codeVerifier } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      message: "Authorization code required",
    });
  }

  if (!codeVerifier) {
    return res.status(400).json({
      success: false,
      message: "Code verifier required for PKCE flow",
    });
  }

  // Validate environment variables
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error("Missing Google OAuth environment variables");
    return res.status(500).json({
      success: false,
      message: "Server configuration error",
    });
  }

  try {
    console.log("Exchanging authorization code for tokens with PKCE...");

    // Exchange authorization code for tokens WITH code verifier
    const { tokens } = await client.getToken({
      code,
      codeVerifier, // This is crucial for PKCE
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    });

    console.log("Tokens received:", tokens ? "Yes" : "No");

    if (!tokens.id_token) {
      return res.status(400).json({
        success: false,
        message: "No ID token received from Google",
      });
    }

    // Verify the ID token
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
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

    console.log("Google user payload:", {
      email,
      firstName,
      surname,
      googleId,
    });

    // Check for existing user by email or googleId
    let user = await User.findOne({
      $or: [{ email }, { googleId }],
    }).exec();

    if (user) {
      // ✅ EXISTING USER: Generate tokens and log them in
      const { accessToken, refreshToken } = generateTokens(user);

      // Save refresh token to user
      user.refreshToken = refreshToken;
      await user.save();

      console.log(
        "Google authentication successful for existing user:",
        user.email
      );

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
          },
        },
      });
    }
  } catch (err) {
    console.error("Google Auth Error:", err);

    // More specific error messages
    if (err.message.includes("invalid_grant")) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid authorization code or code verifier. The code may have expired. Please try signing in again.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Google authentication failed",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};
module.exports = {
  handleCheckUser,
  handleSignup,
  handleLogin,
  handleLogout,
  handleRefreshToken,
  handleGoogleAuth,
};
