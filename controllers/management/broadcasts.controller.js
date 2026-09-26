const Broadcast = require("../../models/management/broadcast.schema");
const User = require("../../models/client/user.schema");
const notifications = require("../../services/notification");
const resultFor = (record) => ({
  id: String(record._id),
  sent: record.sentCount,
  pushSent: record.pushCount,
  targetGroup: record.targetGroup,
  status: record.status,
});
const dispatchBroadcast = async (req, res) => {
  const {
    title,
    message,
    targetGroup = "all",
    priority = "NORMAL",
    requestId,
  } = req.body;
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 160 ||
    typeof message !== "string" ||
    !message.trim() ||
    message.trim().length > 5000 ||
    !["all", "organisers", "staff"].includes(targetGroup) ||
    !["NORMAL", "HIGH", "URGENT"].includes(priority) ||
    typeof requestId !== "string" ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(requestId)
  ) {
    return res
      .status(400)
      .json({
        success: false,
        message:
          "Provide a title (up to 160 characters), message (up to 5000), valid audience, priority and request ID.",
      });
  }
  let record;
  try {
    try {
      record = await Broadcast.create({
        sentBy: req.user.id,
        requestId,
        title: title.trim(),
        message: message.trim(),
        targetGroup,
        priority,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await Broadcast.findOne({
        sentBy: req.user.id,
        requestId,
      });
      if (
        !existing ||
        existing.title !== title.trim() ||
        existing.message !== message.trim() ||
        existing.targetGroup !== targetGroup ||
        existing.priority !== priority
      )
        return res
          .status(409)
          .json({
            success: false,
            message: "This request ID belongs to another announcement.",
          });
      if (existing.status === "COMPLETED" || existing.status === "PARTIAL")
        return res
          .status(200)
          .json({ success: true, data: resultFor(existing) });
      return res
        .status(409)
        .json({
          success: false,
          message:
            "This dispatch was already started. Review broadcast history before creating another announcement.",
        });
    }
    const query = { isActive: { $ne: false } };
    if (targetGroup !== "all")
      query.roles = targetGroup === "organisers" ? "organiser" : "staff";
    const users = await User.find(query).select("_id").lean();
    record.recipientCount = users.length;
    await record.save();
    const result = await notifications.dispatchBulkNotifications({
      recipients: users.map((user) => user._id),
      sender: req.user.id,
      type: notifications.NOTIFICATION_TYPES.ANNOUNCEMENT,
      title: record.title,
      message: record.message,
      priority: priority.toLowerCase(),
      channels: ["in_app", "push"],
      data: { broadcastId: String(record._id) },
    });
    record.sentCount = result.inAppCount;
    record.pushCount = result.pushCount;
    record.status = result.inAppCount < users.length ? "PARTIAL" : "COMPLETED";
    record.completedAt = new Date();
    await record.save();
    return res.status(201).json({ success: true, data: resultFor(record) });
  } catch (error) {
    if (record) {
      // Delivery may have partially succeeded. Never replay a failed/unknown dispatch automatically.
      record.status = "FAILED";
      try {
        await record.save();
      } catch (saveError) {
        console.error("[BROADCAST HISTORY]", saveError.message);
      }
    }
    console.error("[ADMIN BROADCAST]", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message:
          "Dispatch could not be confirmed. Review broadcast history before sending another announcement.",
      });
  }
};
const getBroadcasts = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
    );
    const [records, total] = await Promise.all([
      Broadcast.find({})
        .populate("sentBy", "firstName surname email")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Broadcast.countDocuments({}),
    ]);
    return res.json({
      success: true,
      data: {
        broadcasts: records.map(({ _id, ...record }) => ({
          ...record,
          id: String(_id),
        })),
        pagination: { total, page, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    console.error("[ADMIN BROADCAST HISTORY]", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Unable to load broadcast history" });
  }
};
module.exports = { dispatchBroadcast, getBroadcasts };
