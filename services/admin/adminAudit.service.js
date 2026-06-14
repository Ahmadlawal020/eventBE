const AdminAuditLog = require("../../models/admin/adminAuditLog.schema");

const recordAdminAction = async ({
  req,
  action,
  targetType,
  targetId,
  previousValue = null,
  newValue = null,
  metadata = {},
}) => {
  if (!req?.user?.id || !action || !targetType) return null;

  return AdminAuditLog.create({
    admin: req.user.id,
    action,
    targetType,
    targetId,
    previousValue,
    newValue,
    metadata,
    ipAddress: req.ip,
  });
};

module.exports = {
  recordAdminAction,
};
