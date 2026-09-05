const Notification = require("../../models/client/notification.schema");
const User = require("../../models/client/user.schema");
const { isExpoPushToken } = require("../../services/notification/push.service");
const { NOTIFICATION_CATEGORIES } = require("../../constants/notificationTypes");

/**
 * 📩 Get paginated notifications for the logged-in user with filtering
 */
const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const { category, unreadOnly } = req.query;

    const filter = { recipient: userId };

    if (category && category !== "ALL" && Object.values(NOTIFICATION_CATEGORIES).includes(category.toUpperCase())) {
      filter.category = category.toUpperCase();
    }

    if (unreadOnly === "true" || unreadOnly === true) {
      filter.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .populate("sender", "firstName surname profilePicture")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: userId, isRead: false }),
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        unreadCount,
      },
    });
  } catch (error) {
    console.error("[GET MY NOTIFICATIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error retrieving notifications" });
  }
};

/**
 * 🔢 Get unread notifications count (lightweight & fast)
 */
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });

    res.json({
      success: true,
      data: { unreadCount },
    });
  } catch (error) {
    console.error("[GET UNREAD COUNT] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error getting unread count" });
  }
};

/**
 * 📩 Mark single notification as read
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      { isRead: true, readAt: new Date() },
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

    const result = await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.json({
      success: true,
      message: "All notifications marked as read",
      data: { modifiedCount: result.modifiedCount },
    });
  } catch (error) {
    console.error("[MARK ALL NOTIFICATIONS READ] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🗑️ Delete single notification
 */
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndDelete({ _id: id, recipient: userId });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    res.json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("[DELETE NOTIFICATION] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error deleting notification" });
  }
};

/**
 * 🗑️ Clear notifications (read-only or all)
 */
const clearNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { mode = "read_only" } = req.query;

    const query = { recipient: userId };
    if (mode === "read_only") {
      query.isRead = true;
    }

    const result = await Notification.deleteMany(query);

    res.json({
      success: true,
      message: mode === "read_only" ? "Read notifications cleared" : "All notifications cleared",
      data: { deletedCount: result.deletedCount },
    });
  } catch (error) {
    console.error("[CLEAR NOTIFICATIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error clearing notifications" });
  }
};

/**
 * 📲 Register or update Expo Push Token for device
 */
const registerPushToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token, platform = "android", deviceId = null, deviceModel = null } = req.body;

    if (!token || !isExpoPushToken(token)) {
      return res.status(400).json({
        success: false,
        message: "A valid Expo push token is required",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Check if token already exists on user profile
    const existingIndex = user.pushTokens.findIndex((t) => t.token === token);

    if (existingIndex > -1) {
      user.pushTokens[existingIndex].lastUsedAt = new Date();
      user.pushTokens[existingIndex].platform = platform;
      if (deviceId) user.pushTokens[existingIndex].deviceId = deviceId;
      if (deviceModel) user.pushTokens[existingIndex].deviceModel = deviceModel;
    } else {
      user.pushTokens.push({
        token,
        platform,
        deviceId,
        deviceModel,
        lastUsedAt: new Date(),
      });
    }

    await user.save();

    res.json({
      success: true,
      message: "Push token registered successfully",
    });
  } catch (error) {
    console.error("[REGISTER PUSH TOKEN] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error registering push token" });
  }
};

/**
 * 📲 Remove Expo Push Token on logout or uninstall
 */
const removePushToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required" });
    }

    await User.updateOne(
      { _id: userId },
      { $pull: { pushTokens: { token } } }
    );

    res.json({
      success: true,
      message: "Push token removed successfully",
    });
  } catch (error) {
    console.error("[REMOVE PUSH TOKEN] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error removing push token" });
  }
};

/**
 * ⚙️ Get User Notification Preferences
 */
const getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("notificationPreferences").lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const defaultPreferences = {
      channels: {
        push: true,
        email: true,
        sms: false,
      },
      categories: {
        bookings: true,
        tickets: true,
        teamAndInvites: true,
        messages: true,
        reminders: true,
        offersAndPromotions: true,
        newsAndUpdates: true,
      },
    };

    const preferences = {
      channels: {
        ...defaultPreferences.channels,
        ...(user.notificationPreferences?.channels || {}),
      },
      categories: {
        ...defaultPreferences.categories,
        ...(user.notificationPreferences?.categories || {}),
      },
    };

    res.json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    console.error("[GET PREFERENCES] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error retrieving preferences" });
  }
};

/**
 * ⚙️ Update User Notification Preferences
 */
const updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { channels, categories } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.notificationPreferences) {
      user.notificationPreferences = {};
    }

    if (channels && typeof channels === "object") {
      user.notificationPreferences.channels = {
        ...user.notificationPreferences.channels?.toObject?.() || user.notificationPreferences.channels || {},
        ...channels,
      };
    }

    if (categories && typeof categories === "object") {
      user.notificationPreferences.categories = {
        ...user.notificationPreferences.categories?.toObject?.() || user.notificationPreferences.categories || {},
        ...categories,
      };
    }

    await user.save();

    res.json({
      success: true,
      message: "Notification preferences updated successfully",
      data: user.notificationPreferences,
    });
  } catch (error) {
    console.error("[UPDATE PREFERENCES] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error updating preferences" });
  }
};

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearNotifications,
  registerPushToken,
  removePushToken,
  getPreferences,
  updatePreferences,
};
