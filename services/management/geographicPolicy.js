const ROLES = {
  viewer: ["records.read", "settings.read"],
  moderator: ["records.read", "records.unlist", "settings.read"],
  regional_manager: ["records.read", "records.unlist", "settings.read", "settings.write"],
};
const SUPER_ROLES = ["super_admin", "superadmin", "admin"];
function accessFor(staff) {
  if (staff.geographicAccess) return staff.geographicAccess;
  // Explicit compatibility exception for existing platform owners only.
  return { mode: (staff.roles || []).some(r => SUPER_ROLES.includes(r)) ? "global" : "scoped", grants: [] };
}
function isGlobal(staff) { return accessFor(staff).mode === "global"; }
function isOwner(staff) { return isGlobal(staff) && (staff.roles || []).some(r => SUPER_ROLES.includes(r)); }
function activeStaff(staff, now = new Date()) {
  return Boolean(staff && staff.isActive && (!staff.status || staff.status === "active") &&
    (!staff.accountStatus || staff.accountStatus === "Active") &&
    (!staff.startDate || new Date(staff.startDate) <= now) &&
    (!staff.accessExpiresAt || new Date(staff.accessExpiresAt) > now));
}
function can(staff, location, action, now = new Date()) {
  if (isGlobal(staff)) {
    if (isOwner(staff)) return true;
    if (action === "records.unlist") return (staff.roles || []).includes("moderator");
    return ["records.read", "settings.read"].includes(action);
  }
  if (!location) return false;
  const path = [String(location._id), ...(location.ancestors || []).map(String)];
  return (accessFor(staff).grants || []).some(g =>
    (!g.expiresAt || new Date(g.expiresAt) > now) &&
    ROLES[g.role]?.includes(action) &&
    (String(g.location) === String(location._id) || (g.includeDescendants && path.includes(String(g.location)))));
}
function mergeSettings(defaults, levels) {
  const values = { ...defaults }, sources = {}, lockedBy = {};
  for (const key of Object.keys(values)) sources[key] = "global";
  for (const level of levels) {
    for (const [key, value] of Object.entries(level.overrides || {})) {
      if (Object.hasOwn(defaults, key) && !lockedBy[key]) { values[key] = value; sources[key] = level.scope; }
    }
    for (const key of level.locks || []) if (Object.hasOwn(defaults, key) && !lockedBy[key]) lockedBy[key] = level.scope;
  }
  return { values, sources, lockedBy };
}
module.exports = { ROLES, accessFor, isGlobal, isOwner, activeStaff, can, mergeSettings };
