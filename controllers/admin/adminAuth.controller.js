const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Admin = require("../../models/admin/admin.schema");
const { ADMIN_ROLES } = require("../../middleware/admin/verifyAdmin");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

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
  profilePicture: user.profilePicture,
});

const handleAdminLogin = asyncHandler(async (req, res) => {
  let { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password required" });
  }

  email = email.trim().toLowerCase();

  const foundAdmin = await Admin.findOne({ email }).exec();
  if (!foundAdmin || !foundAdmin.isActive) {
    return res.status(401).json({ success: false, message: "Invalid admin credentials" });
  }

  const hasAdminRole = foundAdmin.roles?.some((role) => ADMIN_ROLES.includes(role));
  if (!hasAdminRole) {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }

  const match = await bcrypt.compare(password, foundAdmin.password || "");
  if (!match) {
    return res.status(401).json({ success: false, message: "Invalid admin credentials" });
  }

  const { accessToken, refreshToken } = generateTokens(foundAdmin);
  foundAdmin.refreshToken = refreshToken;
  foundAdmin.lastLoginAt = new Date();
  await foundAdmin.save();

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
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: "Refresh token required" });
  }

  const foundAdmin = await Admin.findOne({ refreshToken }).exec();
  if (!foundAdmin) {
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
  const { refreshToken } = req.body;
  if (!refreshToken) return res.sendStatus(204);

  const foundAdmin = await Admin.findOne({ refreshToken }).exec();
  if (!foundAdmin) return res.sendStatus(204);

  foundAdmin.refreshToken = "";
  await foundAdmin.save();

  res.status(200).json({ success: true, message: "Admin logged out" });
});

const registerAdmin = asyncHandler(async (req, res) => {
  const { firstName, surname, email, password, roles } = req.body;

  if (!firstName || !surname || !email || !password) {
    return res.status(400).json({ success: false, message: "First name, surname, email, and password are required" });
  }

  // We allow bootstrap without auth if there are zero admins
  const adminCount = await Admin.countDocuments();
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
      
      if (!requestingUser || !requestingUser.roles || !requestingUser.roles.some(role => ADMIN_ROLES.includes(role))) {
        return res.status(403).json({ success: false, message: "Admin access required to register a new admin" });
      }
    } catch (err) {
      return res.status(403).json({ success: false, message: "Forbidden - Invalid admin token" });
    }
  }

  const existingAdmin = await Admin.findOne({ email: email.toLowerCase() }).exec();
  if (existingAdmin) {
    return res.status(409).json({ success: false, message: "Admin with this email already exists" });
  }

  const newAdmin = await Admin.create({
    firstName,
    surname,
    email: email.toLowerCase(),
    password,
    roles: roles && roles.length > 0 ? roles : ["staff"],
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

  const staff = await Admin.findOne({
    inviteToken: token,
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

  const staff = await Admin.findOne({
    inviteToken: token,
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
  staff.inviteToken = null;
  staff.inviteTokenExpiresAt = null;
  
  await staff.save();

  // Generate tokens so they are logged in immediately
  const { accessToken, refreshToken } = generateTokens(staff);
  staff.refreshToken = refreshToken;
  staff.lastLoginAt = new Date();
  await staff.save();

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

module.exports = {
  handleAdminLogin,
  handleAdminRefreshToken,
  handleAdminLogout,
  registerAdmin,
  verifyInviteToken,
  acceptInvite,
};
