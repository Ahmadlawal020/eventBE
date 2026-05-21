const express = require("express");
const router = express.Router();
const messageController = require("../../controllers/user/message.controller");
const verifyJWT = require("../../middleware/verifyJWT");

// All messaging routes require authentication
router.use(verifyJWT);

router.post("/send", messageController.sendMessage);
router.get("/conversations", messageController.getConversations);
router.get("/conversations/:conversationId/messages", messageController.getMessages);

module.exports = router;
