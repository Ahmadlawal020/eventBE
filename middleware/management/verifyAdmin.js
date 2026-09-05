const verifyJWT = require("../verifyJWT");

const ADMIN_ROLES = ["admin", "super_admin", "support_admin", "finance_admin", "moderator"];

const verifyAdmin = [
  verifyJWT,
  (req, res, next) => {
    const roles = req.user?.roles || [];
    const hasAdminRole = roles.some((role) => ADMIN_ROLES.includes(role));

    if (!hasAdminRole) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    next();
  },
];

module.exports = verifyAdmin;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
