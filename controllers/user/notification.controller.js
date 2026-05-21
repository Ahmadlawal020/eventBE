const Notification = require("../../models/user/notification.schema");

/**
 * 📩 Get all notifications for the logged-in user
 */
const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const notifications = await Notification.find({ recipient: userId })
      .populate("sender", "firstName surname profilePicture")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    console.error("[GET MY NOTIFICATIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📩 Mark notification as read
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    console.error("[MARK NOTIFICATION READ] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📩 Mark all notifications as read
 */
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );

    res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("[MARK ALL NOTIFICATIONS READ] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
};
