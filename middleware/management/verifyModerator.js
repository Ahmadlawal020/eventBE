module.exports = (req, res, next) => {
  const allowed = ["admin", "superadmin", "super_admin", "moderator", "modarator"];
  if (!(req.user?.roles || []).some(role => allowed.includes(role))) {
    return res.status(403).json({ success: false, message: "Moderator access required" });
  }
  next();
};
