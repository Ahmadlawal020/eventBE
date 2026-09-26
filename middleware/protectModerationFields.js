module.exports = (req, res, next) => {
  if (Object.keys(req.body || {}).some(key =>
    key === "moderation" || key.startsWith("moderation.") || key.startsWith("$")
  )) {
    console.error("[protectModerationFields] Rejected keys in body:", Object.keys(req.body || {}));
    return res.status(400).json({ success: false, message: "Moderation fields can only be changed by a moderator." });
  }
  next();
};
