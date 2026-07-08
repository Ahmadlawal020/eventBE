const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getConversations,
  getConversationMessages,
  sendReply,
  broadcastNotification,
} = require("../../controllers/admin/adminSupport.controller");

router.use(verifyAdmin);

router.get("/conversations", getConversations);
router.get("/:id/messages", getConversationMessages);
router.post("/:id/reply", sendReply);
router.post("/broadcast", broadcastNotification);

module.exports = router;
