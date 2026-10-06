const { isGlobal, isOwner } = require("../../services/management/geographicPolicy");
// Fail closed for every old/new management endpoint until it has scope-aware queries.
module.exports = (req, res, next) => {
  if (req.path === "/geography" || req.path.startsWith("/geography/")) return next();
  if (req.path === "/listings" || req.path.startsWith("/listings/")) return next();
  if (!isGlobal(req.managementStaff) || req.managementStaff.dataRestrictions?.length) {
    return res.status(403).json({ success: false, code: "REGIONAL_WORKSPACE_REQUIRED", message: "Use the regional workspace. This module requires unrestricted platform access." });
  }
  if (["staff", "settings", "audit-logs", "event-settings", "event-center-settings"].includes(req.path.split("/")[1]) && !isOwner(req.managementStaff)) {
    return res.status(403).json({ success: false, message: "Global administrator access required" });
  }
  next();
};
