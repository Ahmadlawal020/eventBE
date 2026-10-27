const jwt = require("jsonwebtoken");
const User = require("../models/client/user.schema");
const Staff = require("../models/management/staff.schema");
module.exports = async (req, res, next) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Unauthorized" });
  let decoded;
  try { decoded = jwt.verify(header.slice(7), process.env.ACCESS_TOKEN_SECRET); }
  catch { return res.status(401).json({ success: false, message: "Session expired. Please sign in again." }); }
  if (!decoded.UserInfo?.id) return res.status(401).json({ success: false, message: "Invalid session" });
  try {
    // Management accounts are stored separately; never fall back between account types.
    const management = /^\/api\/admin(?:\/|$)/.test(req.originalUrl || "");
    const account = await (management ? Staff : User).findById(decoded.UserInfo.id)
      .select("email roles isActive sessionVersion status accountStatus startDate accessExpiresAt").lean();
    const active = management ? require("../services/management/geographicPolicy").activeStaff(account)
      : account && account.isActive !== false;
    if (!active) return res.status(403).json({ success: false, message: "Account is unavailable or suspended." });
    if ((decoded.UserInfo.sessionVersion || 0) !== (account.sessionVersion || 0))
      return res.status(401).json({ success: false, message: "Session revoked. Please sign in again." });
    req.user = { id: String(account._id), email: account.email, roles: account.roles };
    next();
  } catch (error) { next(error); }
};
