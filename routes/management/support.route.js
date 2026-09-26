const {
  dispatchBroadcast,
  getBroadcasts,
} = require("../../controllers/management/broadcasts.controller");
const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const {
  getConversations,
  getConversationMessages,
  sendReply,
} = require("../../controllers/management/support.controller");

router.use(verifyAdmin);

router.get("/conversations", getConversations);
router.get("/:id/messages", getConversationMessages);
router.post("/:id/reply", sendReply);
router.get("/broadcasts", getBroadcasts);
router.post("/broadcast", dispatchBroadcast);

module.exports = router;
