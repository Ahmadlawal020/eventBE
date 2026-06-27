const Message = require("../../models/user/message.schema");
const Conversation = require("../../models/user/conversation.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const { logActivity } = require("./staffDashboard.controller");

// Helper function to check if a staff is authorized for CUSTOMER_CARE
const checkStaffCareAccess = async (userId, listingId) => {
  try {
    const staffInvite = await StaffInvitation.findOne({
      staff: userId,
      "listings.listingId": listingId,
      status: "ACCEPTED",
      permissions: { $in: ["CUSTOMER_CARE", "MANAGE_CUSTOMER_CARE"] }
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
      contextId: listingId
    })
      .populate("participants", "firstName surname profilePicture")
      .populate({
        path: "lastMessage",
        select: "content createdAt sender",
      })
      .populate({
        path: "contextId",
        select: "title venueName images createdBy",
      })
      .sort({ updatedAt: -1 });

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

    const messages = await Message.find({ conversationId, contextId: listingId })
      .sort({ createdAt: 1 })
      .populate("sender", "firstName surname profilePicture")
      .populate("receiver", "firstName surname profilePicture");

    // Mark messages as read for the staff member
    await Message.updateMany(
      { conversationId, contextId: listingId, receiver: staffId, read: false },
      { $set: { read: true } }
    );

    // Clear unread count for the staff member who is reading
    const conversation = await Conversation.findOne({ _id: conversationId, contextId: listingId });
    if (conversation) {
      conversation.unreadCount.set(staffId.toString(), 0);
      await conversation.save();
    }

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

    const hasAccess = await checkStaffCareAccess(staffId, contextId);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: "Unauthorized to reply on behalf of this listing" });
    }

    let conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    if (conversation.contextId.toString() !== contextId.toString()) {
      return res.status(400).json({ success: false, message: "Conversation does not match the provided contextId." });
    }

    // Determine the receiver (the guest user)
    let context;
    if (contextType === "Event") {
      context = await Event.findById(contextId);
    } else {
      context = await EventCenter.findById(contextId);
    }

    if (!context) {
      return res.status(404).json({ success: false, message: "Context listing not found" });
    }

    const organiserId = context.createdBy ? context.createdBy.toString() : null;
    if (!organiserId) {
      return res.status(400).json({ success: false, message: "Listing creator not found" });
    }
    
    // Find the participant who is not the organiser (the user who inquired)
    let receiverId = conversation.participants.find(p => p && p.toString() !== organiserId);
    if (!receiverId && conversation.participants.length === 2) {
      receiverId = conversation.participants[0].toString() === organiserId ? conversation.participants[1] : conversation.participants[0];
    }

    if (!receiverId) {
      return res.status(400).json({ success: false, message: "Could not identify recipient from participants." });
    }

    // Reply tracking
    if (!conversation.isReplied) {
      conversation.isReplied = true;
      if (context.performance) {
        context.performance.pendingInquiries = Math.max(0, (context.performance.pendingInquiries || 0) - 1);
        context.performance.responseRate = 100;
        await context.save();
      }
    }

    // Note: The message is saved with sender as staffId so we know who sent it,
    // but the receiver is the user who started the conversation
    const newMessage = new Message({
      conversationId: conversation._id,
      sender: staffId,
      receiver: receiverId,
      content,
      contextType,
      contextId,
    });

    const savedMessage = await newMessage.save();

    conversation.lastMessage = savedMessage._id;
    const currentUnread = conversation.unreadCount.get(receiverId.toString()) || 0;
    conversation.unreadCount.set(receiverId.toString(), currentUnread + 1);
    
    await conversation.save();

    res.status(201).json({
      success: true,
      message: "Message sent successfully by staff",
      data: savedMessage,
    });

    // Log activity (fire-and-forget)
    logActivity(
      staffId,
      context.createdBy,
      "TASK_COMPLETE",
      "Message Sent",
      `Replied to a conversation on behalf of the listing`,
      { conversationId: conversation._id, contextId, contextType }
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
