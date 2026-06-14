const AdminAuditLog = require("../../models/admin/adminAuditLog.schema");

const getAuditLogs = async (req, res) => {
  try {
    const { action, targetType, page = 1, limit = 30 } = req.query;
    const query = {};

    if (action) query.action = action;
    if (targetType) query.targetType = targetType;

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(query)
        .populate("admin", "firstName surname email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      AdminAuditLog.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET AUDIT LOGS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching audit logs" });
  }
};

module.exports = {
  getAuditLogs,
};
