const Message = require("../../models/client/message.schema");
const Conversation = require("../../models/client/conversation.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const StaffInvitation = require("../../models/client/staffInvitation.schema");
const User = require("../../models/client/user.schema");
const { dispatchNotification, NOTIFICATION_TYPES } = require("../../services/notification");
const { logActivity } = require("./staffDashboard.controller");

// Helper function to check if a staff is authorized for CUSTOMER_CARE
const checkStaffCareAccess = async (userId, listingId) => {
  try {
    if (!userId || !listingId) return false;

    const staffInvite = await StaffInvitation.findOne({
      staff: userId,
      "listings.listingId": listingId,
      status: "ACCEPTED",
      permissions: { $in: ["CUSTOMER_CARE", "MANAGE_CUSTOMER_CARE", "ALL_ACCESS"] },
    });
    return !!staffInvite;
  } catch (err) {
    console.error("[checkStaffCareAccess ERROR]", err);
    return false;
  }
};

// 📋 Get Conversations for a Single Assigned Listing
const getStaffConversations = async (req, res) => {
  const { listingId } = req.params;
  const staffId = req.user.id;

  try {
    const hasAccess = await checkStaffCareAccess(staffId, listingId);

    if (!hasAccess) {
      return res.status(403).json({ success: false, message: "Unauthorized access to these messages" });
    }

    const conversations = await Conversation.find({
      contextId: listingId,
    })
      .populate("participants", "firstName surname profilePicture")
      .populate({
        path: "lastMessage",
        select: "content createdAt sender read",
      })
      .populate({
        path: "contextId",
        select: "title venueName images createdBy",
      })
      .sort({ updatedAt: -1 })
      .lean();

    res.json({
      success: true,
      message: "Staff conversations fetched successfully",
      data: conversations,
    });
  } catch (err) {
    console.error("[GET STAFF CONVERSATIONS ERROR]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 💬 Get Messages for a specific conversation as Staff
const getStaffMessages = async (req, res) => {
  const { conversationId, listingId } = req.params;
  const staffId = req.user.id;

  try {
    const hasAccess = await checkStaffCareAccess(staffId, listingId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: "Unauthorized access to these messages" });
    }

    const [messages, conversation] = await Promise.all([
      Message.find({ conversationId, contextId: listingId })
        .sort({ createdAt: 1 })
        .populate("sender", "firstName surname profilePicture")
        .populate("receiver", "firstName surname profilePicture")
        .lean(),
      Conversation.findOne({ _id: conversationId, contextId: listingId }),
    ]);

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    // Mark guest messages as read
    await Message.updateMany(
      { conversationId, contextId: listingId, sender: { $ne: staffId }, read: false },
      { $set: { read: true } }
    );

    // Clear unread count for staff and the listing owner
    const unreadMap = conversation.unreadCount instanceof Map
      ? conversation.unreadCount
      : new Map(Object.entries(conversation.unreadCount || {}));

    unreadMap.set(staffId.toString(), 0);

    let contextListing = await Event.findById(listingId).select("createdBy");
    if (!contextListing) {
      contextListing = await EventCenter.findById(listingId).select("createdBy");
    }
    if (contextListing?.createdBy) {
      unreadMap.set(contextListing.createdBy.toString(), 0);
    }

    conversation.unreadCount = unreadMap;
    await conversation.save();

    res.json({
      success: true,
      message: "Staff messages fetched successfully",
      data: messages,
    });
  } catch (err) {
    console.error("[GET STAFF MESSAGES ERROR]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📤 Send Message as Staff
const sendStaffMessage = async (req, res) => {
  const { content, contextType, contextId, conversationId } = req.body;
  const staffId = req.user.id;

  try {
    if (!conversationId) {
      return res.status(400).json({ success: false, message: "conversationId is required for staff replies." });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const finalContextId = contextId || conversation.contextId;
    const finalContextType = contextType || conversation.contextType;

    const hasAccess = await checkStaffCareAccess(staffId, finalContextId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: "Unauthorized to reply on behalf of this listing" });
    }

    // Determine the listing context and organiser
    let context;
    if (finalContextType === "Event") {
      context = await Event.findById(finalContextId);
    } else {
      context = await EventCenter.findById(finalContextId);
    }

    if (!context) {
      return res.status(404).json({ success: false, message: "Context listing not found" });
    }

    const organiserId = context.createdBy ? context.createdBy.toString() : null;
    if (!organiserId) {
      return res.status(400).json({ success: false, message: "Listing creator not found" });
    }

    // Find the recipient (the guest who inquired)
    let receiverId = conversation.participants.find(
      (p) => p && p.toString() !== organiserId && p.toString() !== staffId.toString()
    );
    if (!receiverId && conversation.participants.length >= 2) {
      receiverId = conversation.participants[0].toString() === organiserId
        ? conversation.participants[1]
        : conversation.participants[0];
    }

    if (!receiverId) {
      return res.status(400).json({ success: false, message: "Could not identify recipient from participants." });
    }

    // Reply tracking
    if (!conversation.isReplied) {
      conversation.isReplied = true;
      if (!context.performance) context.performance = {};
      context.performance.pendingInquiries = Math.max(0, (context.performance.pendingInquiries || 0) - 1);
      context.performance.responseRate = 100;
      await context.save();
    }

    const newMessage = new Message({
      conversationId: conversation._id,
      sender: staffId,
      receiver: receiverId,
      content: content.trim(),
      contextType: finalContextType,
      contextId: finalContextId,
    });

    const savedMessage = await newMessage.save();

    conversation.lastMessage = savedMessage._id;

    const unreadMap = conversation.unreadCount instanceof Map
      ? conversation.unreadCount
      : new Map(Object.entries(conversation.unreadCount || {}));
    const currentUnread = unreadMap.get(receiverId.toString()) || 0;
    unreadMap.set(receiverId.toString(), currentUnread + 1);
    conversation.unreadCount = unreadMap;

    await conversation.save();

    // Dispatch notification to guest
    try {
      const staffUser = await User.findById(staffId).select("firstName surname profilePicture").lean();
      const staffName = `${staffUser?.firstName || ""} ${staffUser?.surname || ""}`.trim() || "Support Staff";
      const snippet = content.length > 80 ? `${content.substring(0, 80)}...` : content;

      await dispatchNotification({
        recipient: receiverId,
        sender: staffId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: `Message from ${staffName}`,
        message: snippet,
        referenceId: conversation._id,
        referenceType: "Conversation",
        data: {
          screen: "ChatScreen",
          conversationId: String(conversation._id),
          senderId: String(staffId),
        },
        priority: "high",
      });
    } catch (notifErr) {
      console.error("[STAFF MESSAGE NOTIFICATION ERROR]", notifErr);
    }

    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("sender", "firstName surname profilePicture")
      .populate("receiver", "firstName surname profilePicture")
      .lean();

    res.status(201).json({
      success: true,
      message: "Message sent successfully by staff",
      data: populatedMessage || savedMessage,
    });

    // Log activity (fire-and-forget)
    logActivity(
      staffId,
      context.createdBy,
      "TASK_COMPLETE",
      "Message Sent",
      `Replied to a conversation on behalf of the listing`,
      { conversationId: conversation._id, contextId: finalContextId, contextType: finalContextType }
    );
  } catch (err) {
    console.error("[SEND STAFF MESSAGE ERROR]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getStaffConversations,
  getStaffMessages,
  sendStaffMessage,
};
