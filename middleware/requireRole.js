/**
 * Middleware factory that checks if the authenticated user has at least one of the specified roles.
 * Must be used after verifyJWT middleware.
 *
 * @param  {...string} roles - Allowed roles
 * @returns {Function} Express middleware
 */
const requireRole = (...roles) => (req, res, next) => {
  const userRoles = req.user?.roles || [];
  const hasRole = userRoles.some((role) => roles.includes(role));

  if (!hasRole) {
    return res.status(403).json({
      success: false,
      message: "Insufficient permissions. Required role: " + roles.join(" or "),
    });
  }

  next();
};

module.exports = requireRole;
