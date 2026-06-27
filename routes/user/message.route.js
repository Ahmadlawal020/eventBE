const express = require("express");
const router = express.Router();
const messageController = require("../../controllers/user/message.controller");
const verifyJWT = require("../../middleware/verifyJWT");
const validateRequest = require("../../middleware/validateRequest");
const generateLimiter = require("../../middleware/generateLimiter");
const { sendMessageSchema } = require("../../utils/validationSchemas");

const messageSendLimiter = generateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many messages sent. Please slow down.",
});

// All messaging routes require authentication
router.use(verifyJWT);

router.post("/send", messageSendLimiter, validateRequest(sendMessageSchema), messageController.sendMessage);
router.get("/conversations", messageController.getConversations);
router.get("/conversations/:conversationId/messages", messageController.getMessages);

module.exports = router;
