const verifyJWT = require("../verifyJWT");
const Staff = require("../../models/management/staff.schema");
const { activeStaff } = require("../../services/management/geographicPolicy");
const ADMIN_ROLES = ["admin", "super_admin", "superadmin", "support_admin", "finance_admin", "finance", "moderator"];
function requireAdminRoles(allowedRoles, message = "Insufficient administrator permissions") {
  return (req, res, next) => {
    const roles = req.managementStaff?.roles || req.user?.roles || [];
    if (!roles.some(role => allowedRoles.includes(role))) {
      return res.status(403).json({ success: false, message });
    }
    next();
  };
}
const verifyAdmin = [
  (req, res, next) => req.managementStaff ? next() : verifyJWT(req, res, next),
  async (req, res, next) => {
    try {
      if (req.managementStaff) return next();
      const staff = await Staff.findById(req.user?.id).select("-password -refreshToken").lean();
      if (!activeStaff(staff) || !staff.roles?.some(role => ADMIN_ROLES.includes(role))) return res.status(403).json({ success: false, message: "Active admin access required" });
      req.managementStaff = staff;
      req.user = { ...req.user, roles: staff.roles };
      next();
    } catch (error) { next(error); }
  },
];
module.exports = verifyAdmin;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
module.exports.requireAdminRoles = requireAdminRoles;
