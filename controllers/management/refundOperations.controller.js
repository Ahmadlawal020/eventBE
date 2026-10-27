const mongoose = require("mongoose");
const Outbox = require("../../models/client/notificationOutbox.schema");
const Audit = require("../../models/management/adminAuditLog.schema");
async function operations(req, res) {
  try {
    res.json({
      data: await require("../../services/refundOperations.service").getRefundOperations(),
    });
  } catch {
    res.status(500).json({ message: "Could not load worker health." });
  }
}
async function failedNotices(req, res) {
  try {
    const data = await Outbox.find({ failedAt: { $ne: null } })
      .select("recipient type title attempts lastError failedAt")
      .sort({ failedAt: -1 })
      .limit(100)
      .lean();
    res.json({ data });
  } catch {
    res.status(500).json({ message: "Could not load failed notices." });
  }
}
async function retryNotice(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.noticeId))
      return res.status(400).json({ message: "Invalid notice ID." });
    const changed = await mongoose.connection.transaction(async (session) => {
      const notice = await Outbox.findOneAndUpdate(
        {
          _id: req.params.noticeId,
          completedAt: null,
          failedAt: { $ne: null },
        },
        {
          $set: {
            failedAt: null,
            attempts: 0,
            nextAttemptAt: new Date(),
            lockedUntil: new Date(0),
            lastError: null,
          },
        },
        { new: true, session },
      );
      if (notice)
        await Audit.create(
          [
            {
              admin: req.managementStaff?._id || req.user.id,
              action: "RETRY_REFUND_NOTICE",
              targetType: "System",
              targetId: notice._id,
            },
          ],
          { session },
        );
      return notice;
    });
    res.status(changed ? 200 : 409).json({ success: Boolean(changed) });
  } catch {
    res.status(500).json({ message: "Could not retry notice." });
  }
}
module.exports = { operations, failedNotices, retryNotice };
