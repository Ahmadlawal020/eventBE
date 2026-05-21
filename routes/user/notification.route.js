const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
} = require("../../controllers/user/notification.controller");

router.use(verifyJWT);

router.get("/", getMyNotifications);
router.patch("/:id/read", markAsRead);
router.patch("/read-all", markAllAsRead);

module.exports = router;
