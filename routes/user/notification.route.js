const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const {
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
} = require("../../controllers/user/notification.controller");

router.use(verifyJWT);

// Notification retrieval & status
router.get("/", getMyNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);
router.delete("/:id", deleteNotification);
router.delete("/", clearNotifications);

// Push token management
router.post("/push-token", registerPushToken);
router.delete("/push-token", removePushToken);

// User notification preferences
router.get("/preferences", getPreferences);
router.patch("/preferences", updatePreferences);

module.exports = router;
