const mongoose = require("mongoose");
const Conversation = require("../../models/user/conversation.schema");
const Message = require("../../models/user/message.schema");
const { dispatchBulkNotifications, NOTIFICATION_TYPES } = require("../../services/notification");
const User = require("../../models/user/user.schema");

const getConversations = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let matchStage = {};
    if (search) {
      const users = await User.find({
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { surname: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      matchStage.participants = { $in: users.map((u) => u._id) };
    }

    const [conversations, total] = await Promise.all([
      Conversation.find(matchStage)
        .populate("participants", "firstName surname email profilePicture")
        .populate({
          path: "lastMessage",
          select: "content sender read createdAt",
        })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Conversation.countDocuments(matchStage),
    ]);

    const formatted = conversations.map((conv) => {
      const otherParticipants = conv.participants.filter(
        (p) => p._id?.toString() !== req.user.id
      );
      const unreadForAdmin = conv.unreadCount
        ? Array.from(conv.unreadCount.values()).reduce((sum, v) => sum + v, 0)
        : 0;

      return {
        _id: conv._id,
        participants: conv.participants,
        user: otherParticipants[0] || conv.participants[0],
        lastMessage: conv.lastMessage,
        contextType: conv.contextType,
        contextId: conv.contextId,
        isReplied: conv.isReplied,
        unreadCount: unreadForAdmin,
        updatedAt: conv.updatedAt,
        createdAt: conv.createdAt,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        conversations: formatted,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[ADMIN SUPPORT - GET CONVERSATIONS]", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const conversation = await Conversation.findById(id)
      .populate("participants", "firstName surname email profilePicture")
      .lean();

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const [messages, total] = await Promise.all([
      Message.find({ conversationId: id })
        .populate("sender", "firstName surname email profilePicture")
        .populate("receiver", "firstName surname email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Message.countDocuments({ conversationId: id }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        conversation,
        messages: messages.reverse(),
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[ADMIN SUPPORT - GET MESSAGES]", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const sendReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: "Message content is required" });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const adminUser = await User.findById(req.user.id).select("_id");
    if (!adminUser) {
      return res.status(404).json({ success: false, message: "Admin user not found" });
    }

    const recipient = conversation.participants.find(
      (p) => p.toString() !== req.user.id
    ) || conversation.participants[0];

    const message = await Message.create({
      conversationId: id,
      sender: adminUser._id,
      receiver: recipient,
      content: content.trim(),
      read: false,
      contextType: conversation.contextType,
      contextId: conversation.contextId,
    });

    conversation.lastMessage = message._id;
    conversation.isReplied = true;

    const unreadMap = conversation.unreadCount instanceof Map
      ? conversation.unreadCount
      : new Map(Object.entries(conversation.unreadCount || {}));
    const currentUnread = unreadMap.get(recipient.toString()) || 0;
    unreadMap.set(recipient.toString(), currentUnread + 1);
    conversation.unreadCount = unreadMap;

    await conversation.save();

    const populated = await Message.findById(message._id)
      .populate("sender", "firstName surname email profilePicture")
      .populate("receiver", "firstName surname email")
      .lean();

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error("[ADMIN SUPPORT - SEND REPLY]", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const broadcastNotification = async (req, res) => {
  try {
    const { title, message, targetGroup = "all" } = req.body;

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    let userQuery = {};
    if (targetGroup === "organisers") {
      userQuery = { roles: "organiser" };
    } else if (targetGroup === "staff") {
      userQuery = { roles: "staff" };
    }

    const users = await User.find(userQuery).select("_id").lean();
    const recipientIds = users.map((u) => u._id);

    const result = await dispatchBulkNotifications({
      recipients: recipientIds,
      sender: req.user.id,
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      title: title.trim(),
      message: message.trim(),
      channels: ["in_app", "push"],
    });

    res.status(201).json({
      success: true,
      data: {
        sent: result.inAppCount,
        pushSent: result.pushCount,
        targetGroup,
      },
    });
  } catch (error) {
    console.error("[ADMIN SUPPORT - BROADCAST]", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getConversations,
  getConversationMessages,
  sendReply,
  broadcastNotification,
};
