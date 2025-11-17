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

    if (!user) {
      // Create new user
      user = new User({
        firstName: firstName || "User",
        surname: surname || "",
        email,
        googleId,
        authProvider: "google",
        profilePicture: picture,
        // No password for Google auth users
      });
      await user.save();
      console.log("New Google user created:", user._id);
    } else {
      // Update existing user with Google info if needed
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = "google";
        if (firstName && !user.firstName) user.firstName = firstName;
        if (surname && !user.surname) user.surname = surname;
        if (picture && !user.profilePicture) user.profilePicture = picture;
        await user.save();
        console.log("Existing user updated with Google info:", user._id);
      }
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save();

    console.log("Google authentication successful for user:", user.email);

    res.json({
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
// authController.js

// 📝 Signup
// const handleSignup = async (req, res) => {
//   const { firstName, surname, email, password, dob } = req.body;
//   if (!firstName || !surname || !email || !password || !dob) {
//     return res
//       .status(400)
//       .json({ success: false, message: "All fields are required" });
//   }

//   try {
//     const existingUser = await User.findOne({ email }).exec();
//     if (existingUser) {
//       return res
//         .status(409)
//         .json({ success: false, message: "User already exists" });
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);

//     const newUser = new User({
//       firstName,
//       surname,
//       email,
//       dob,
//       password: hashedPassword,
//     });

//     const { accessToken, refreshToken } = generateTokens(newUser);
//     newUser.refreshToken = refreshToken;
//     await newUser.save();

//     res.status(201).json({
//       success: true,
//       message: "Signup successful",
//       data: {
//         user: {
//           id: newUser._id,
//           email: newUser.email,
//           firstName: newUser.firstName,
//           surname: newUser.surname,
//           roles: newUser.roles,
//         },
//         accessToken,
//         refreshToken,
//       },
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };
