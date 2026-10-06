const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Staff = require("../../models/management/staff.schema");
const { ADMIN_ROLES } = require("../../middleware/management/verifyAdmin");
const { recordAdminAction } = require("../../services/management/adminAudit.service");
const OTPService = require("../../services/otp.service");

const REFRESH_COOKIE_NAME = "munasaba_admin_refresh";
const hashInviteToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/api/admin/auth",
};

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
};

const generateTokens = (user) => {
  const { _id: id, email, roles } = user;

  const accessToken = jwt.sign(
    { UserInfo: { id, email, roles } },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" },
  );

  const refreshToken = jwt.sign(
    { id, email },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" },
  );

  return { accessToken, refreshToken };
};

const getAdminUserPayload = (user) => ({
  id: user._id,
  email: user.email,
  firstName: user.firstName,
  surname: user.surname,
  roles: user.roles,
  pageOverrides: user.pageOverrides,
  profilePicture: user.profilePicture,
  geographicAccess: require("../../services/management/geographicPolicy").accessFor(user),
  dataRestrictions: user.dataRestrictions,
});

const handleAdminLogin = asyncHandler(async (req, res) => {
  let { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password required" });
  }

  email = email.trim().toLowerCase();

  const foundAdmin = await Staff.findOne({ email }).exec();
  if (!foundAdmin || !foundAdmin.isActive) {
    return res.status(401).json({ success: false, message: "Invalid admin credentials" });
  }
  const now = new Date();
  if (foundAdmin.lockoutUntil && foundAdmin.lockoutUntil > now) {
    return res.status(423).json({ success: false, message: "Account temporarily locked. Try again later" });
  }
  if ((foundAdmin.startDate && foundAdmin.startDate > now) || (foundAdmin.accessExpiresAt && foundAdmin.accessExpiresAt <= now)) {
    return res.status(403).json({ success: false, message: "Account access is outside its approved access period" });
  }

  const hasAdminRole = foundAdmin.roles?.some((r) => ADMIN_ROLES.includes(r));
  if (!hasAdminRole) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  // Validate specific role selected by the user
  if (role) {
    const normalizedRole = role.toLowerCase().trim();
    const roleMapping = {
      finance: ["finance_admin", "finance", "super_admin", "admin"],
      finance_admin: ["finance_admin", "finance", "super_admin", "admin"],
      modarator: ["moderator", "modarator", "super_admin", "admin"],
      moderator: ["moderator", "modarator", "super_admin", "admin"],
      superadmin: ["super_admin", "superadmin", "admin"],
      super_admin: ["super_admin", "superadmin", "admin"],
      admin: ["super_admin", "superadmin", "admin"],
    };

    const allowedDbRoles = roleMapping[normalizedRole] || [normalizedRole];
    const hasSelectedRole = foundAdmin.roles?.some((r) => allowedDbRoles.includes(r.toLowerCase()));
    if (!hasSelectedRole) {
      return res.status(403).json({
        success: false,
        message: `Account does not have authorization for the selected role: ${role}`,
      });
    }
  }

  const match = await bcrypt.compare(password, foundAdmin.password || "");
  if (!match) {
    foundAdmin.failedLoginAttempts += 1;
    if (foundAdmin.failedLoginAttempts >= 5) foundAdmin.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000);
    await foundAdmin.save();
    return res.status(401).json({ success: false, message: "Invalid admin credentials" });
  }

  const { accessToken, refreshToken } = generateTokens(foundAdmin);
  foundAdmin.refreshToken = refreshToken;
  foundAdmin.lastLoginAt = new Date();
  foundAdmin.failedLoginAttempts = 0;
  foundAdmin.lockoutUntil = null;
  await foundAdmin.save();
  setRefreshCookie(res, refreshToken);

  await recordAdminAction({
    req: { ...req, user: { id: foundAdmin._id } },
    action: "ADMIN_LOGIN",
    targetType: "Admin",
    targetId: foundAdmin._id,
  });

  res.json({
    success: true,
    message: "Admin login successful",
    data: {
      user: getAdminUserPayload(foundAdmin),
      accessToken,
      refreshToken,
    },
  });
});

const handleAdminRefreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body.refreshToken;
  if (!refreshToken) {
    if (req.body?.restore === true) return res.status(200).json({ success: true, message: "No active session" });
    return res.status(400).json({ success: false, message: "Refresh token required" });
  }

  const foundAdmin = await Staff.findOne({ refreshToken }).exec();
  const refreshNow = new Date();
  if (!foundAdmin || !foundAdmin.isActive || (foundAdmin.startDate && foundAdmin.startDate > refreshNow) || (foundAdmin.accessExpiresAt && foundAdmin.accessExpiresAt <= refreshNow)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const hasAdminRole = foundAdmin.roles?.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, async (err, decoded) => {
    if (err || foundAdmin.email !== decoded.email) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { accessToken, refreshToken: newRefresh } = generateTokens(foundAdmin);
    foundAdmin.refreshToken = newRefresh;
    await foundAdmin.save();
    setRefreshCookie(res, newRefresh);

    res.json({
      success: true,
      message: "Token refreshed",
      data: {
        user: getAdminUserPayload(foundAdmin),
        accessToken,
        refreshToken: newRefresh,
      },
    });
  });
});

const handleAdminLogout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body.refreshToken;
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: refreshCookieOptions.httpOnly,
    secure: refreshCookieOptions.secure,
    sameSite: refreshCookieOptions.sameSite,
    path: refreshCookieOptions.path,
  });
  if (!refreshToken) return res.sendStatus(204);

  const foundAdmin = await Staff.findOne({ refreshToken }).exec();
  if (!foundAdmin) return res.sendStatus(204);

  foundAdmin.refreshToken = "";
  await foundAdmin.save();

  res.status(200).json({ success: true, message: "Admin logged out" });
});

const registerAdmin = asyncHandler(async (req, res) => {
  const { firstName, surname, email, password, roles } = req.body;
  const assignableRoles = ["super_admin", "finance_admin", "moderator"];

  if (!firstName || !surname || !email || !password) {
    return res.status(400).json({ success: false, message: "First name, surname, email, and password are required" });
  }

  // We allow bootstrap without auth if there are zero admins
  const adminCount = await Staff.countDocuments();
  const assignedRole = Array.isArray(roles) && roles.length === 1
    ? roles[0]
    : adminCount === 0
      ? "super_admin"
      : null;
  if (!assignedRole || !assignableRoles.includes(assignedRole)) {
    return res.status(400).json({ success: false, message: "Exactly one valid admin role is required" });
  }

  let requestingUser = null;
  
  if (adminCount > 0) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Unauthorized - Admin token required" });
    }

    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      requestingUser = decoded.UserInfo;
      
      const currentStaff = requestingUser?.id ? await Staff.findById(requestingUser.id).lean() : null;
      const policy = require("../../services/management/geographicPolicy");
      if (!policy.activeStaff(currentStaff) || !policy.isOwner(currentStaff)) {
        return res.status(403).json({ success: false, message: "Admin access required to register a new admin" });
      }
    } catch (err) {
      return res.status(403).json({ success: false, message: "Forbidden - Invalid admin token" });
    }
  }

  const existingAdmin = await Staff.findOne({ email: email.toLowerCase() }).exec();
  if (existingAdmin) {
    return res.status(409).json({ success: false, message: "Admin with this email already exists" });
  }

  const newAdmin = await Staff.create({
    firstName,
    surname,
    email: email.toLowerCase(),
    password,
    roles: [assignedRole],
    geographicAccess: { mode: adminCount === 0 ? "global" : "scoped", grants: [] },
  });

  if (requestingUser && requestingUser.id) {
    await recordAdminAction({
      req: { ...req, user: requestingUser },
      action: "ADMIN_REGISTERED",
      targetType: "Admin",
      targetId: newAdmin._id,
      metadata: { email: newAdmin.email, roles: newAdmin.roles }
    });
  }

  res.status(201).json({
    success: true,
    message: "Admin registered successfully",
  });
});

const verifyInviteToken = asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, message: "Invitation token required" });
  }

  const staff = await Staff.findOne({
    inviteToken: { $in: [hashInviteToken(token), token] },
    inviteTokenExpiresAt: { $gt: new Date() },
    status: "pending",
  });

  if (!staff) {
    return res.status(400).json({ success: false, message: "Invalid or expired invitation token" });
  }

  res.status(200).json({
    success: true,
    message: "Token is valid",
    data: {
      email: staff.email,
      firstName: staff.firstName,
      surname: staff.surname,
    },
  });
});

const acceptInvite = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ success: false, message: "Token and password are required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
  }

  const staff = await Staff.findOne({
    inviteToken: { $in: [hashInviteToken(token), token] },
    inviteTokenExpiresAt: { $gt: new Date() },
    status: "pending",
  });

  if (!staff) {
    return res.status(400).json({ success: false, message: "Invalid or expired invitation token" });
  }

  // Set the password and activate the user
  staff.password = password;
  staff.status = "active";
  staff.isActive = true;
  staff.emailVerified = true;
  staff.activatedAt = new Date();
  staff.inviteToken = null;
  staff.inviteTokenExpiresAt = null;
  
  await staff.save();

  // Generate tokens so they are logged in immediately
  const { accessToken, refreshToken } = generateTokens(staff);
  staff.refreshToken = refreshToken;
  staff.lastLoginAt = new Date();
  await staff.save();
  setRefreshCookie(res, refreshToken);

  await recordAdminAction({
    req: { ...req, user: { id: staff._id } },
    action: "STAFF_INVITE_ACCEPTED",
    targetType: "Admin",
    targetId: staff._id,
    metadata: { email: staff.email },
  });

  res.status(200).json({
    success: true,
    message: "Account activated successfully",
    data: {
      user: getAdminUserPayload(staff),
      accessToken,
      refreshToken,
    },
  });
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  let { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  email = email.trim().toLowerCase();

  const foundAdmin = await Staff.findOne({ email }).exec();
  if (!foundAdmin) {
    return res.status(404).json({ success: false, message: "No admin account found with this email" });
  }

  const hasAdminRole = foundAdmin.roles?.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  await OTPService.requestOTP(email, "password_change");

  res.status(200).json({
    success: true,
    message: "Password reset code sent to your email",
  });
});

const updatePassword = asyncHandler(async (req, res) => {
  let { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ success: false, message: "Email, code, and new password are required" });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
  }

  email = email.trim().toLowerCase();

  const otpResult = await OTPService.verifyOTP(email, code, "password_change");
  if (!otpResult.success) {
    return res.status(400).json({ success: false, message: otpResult.message });
  }

  const foundAdmin = await Staff.findOne({ email }).exec();
  if (!foundAdmin) {
    return res.status(404).json({ success: false, message: "Admin not found" });
  }

  foundAdmin.password = newPassword;
  foundAdmin.failedLoginAttempts = 0;
  await foundAdmin.save();

  const OTP = require("../../models/client/otp.schema");
  await OTP.deleteMany({ identifier: email, type: "password_change" });

  res.status(200).json({
    success: true,
    message: "Password updated successfully",
  });
});

module.exports = {
  handleAdminLogin,
  handleAdminRefreshToken,
  handleAdminLogout,
  registerAdmin,
  verifyInviteToken,
  acceptInvite,
  requestPasswordReset,
  updatePassword,
};
