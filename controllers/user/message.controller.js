const Message = require("../../models/user/message.schema");
const Conversation = require("../../models/user/conversation.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
const mongoose = require("mongoose");

// Helper function to check if a user is an authorized representative (Owner, Co-Host, or Staff with CUSTOMER_CARE permission)
const checkCustomerCareAccess = async (userId, listingId, listingType) => {
  try {
    let listing;
    if (listingType === "Event") {
      listing = await Event.findById(listingId);
    } else {
      listing = await EventCenter.findById(listingId);
    }

    if (!listing) return false;

    // 1. Is the original owner?
    if (listing.createdBy && listing.createdBy.toString() === userId.toString()) {
      return true;
    }

    // 2. Is an active Staff with CUSTOMER_CARE permission?
    if (listing.staff && listing.staff.includes(userId)) {
      const staffInvite = await StaffInvitation.findOne({
        staff: userId,
        "listings.listingId": listingId,
        status: "ACCEPTED",
        permissions: "CUSTOMER_CARE"
      });
      if (staffInvite) return true;
    }

    // 3. Is an active Co-Host? (Automatic full access to messages and replies)
    if (listing.coHosts && listing.coHosts.includes(userId)) {
      return true;
    }

    return false;
  } catch (err) {
    console.error("[checkCustomerCareAccess ERROR]", err);
    return false;
  }
};

// 📤 Send Message
const sendMessage = async (req, res) => {
  const { content, contextType, contextId, conversationId } = req.body;
  const senderId = req.user.id;

  try {
    let conversation;
    let receiverId;
    let finalContextType = contextType;
    let finalContextId = contextId;
    let context;

    // 1. Get Context and Identify Organiser
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, message: "Conversation not found" });
      }
      finalContextType = conversation.contextType;
      finalContextId = conversation.contextId;
    }

    if (finalContextType === "Event") {
      context = await Event.findById(finalContextId);
    } else if (finalContextType === "EventCenter") {
      context = await EventCenter.findById(finalContextId);
    }

    if (!context) {
      return res.status(404).json({ success: false, message: "Context not found" });
    }

    const organiserId = context.createdBy.toString();

    // Verify if sender has representative support/customer care access
    const isSenderRepresentative = await checkCustomerCareAccess(senderId, finalContextId, finalContextType);

    if (conversationId) {
      receiverId = conversation.participants.find(p => p && p.toString() !== senderId.toString());
      if (!receiverId && conversation.participants.length === 2) {
        receiverId = conversation.participants[0].toString() === senderId.toString()
          ? conversation.participants[1]
          : conversation.participants[0];
      }
    } else {
      receiverId = organiserId;
      if (isSenderRepresentative) {
        return res.status(400).json({ success: false, message: "Organisers, Co-Hosts, and Staff cannot start conversations with their own listings" });
      }

      conversation = await Conversation.findOne({
        participants: { $all: [senderId, receiverId] },
        contextType,
        contextId,
      });

      if (!conversation) {
        conversation = new Conversation({
          participants: [senderId, receiverId],
          contextType,
          contextId,
          isReplied: true, // Default true, will be set to false below as it's the first message from user
        });
        await conversation.save();

        // Increment total unique inquiries (messages)
        context.performance.messages = (context.performance.messages || 0) + 1;
      }
    }

    // 2. Update Performance Tracking (Pending Inquiries & Response Rate)
    if (!isSenderRepresentative) {
      // Guest is sending a message
      if (conversation.isReplied) {
        conversation.isReplied = false;
        context.performance.pendingInquiries = (context.performance.pendingInquiries || 0) + 1;
      }
    } else {
      // Host representative (Owner, Co-Host, or Staff) is replying
      if (!conversation.isReplied) {
        conversation.isReplied = true;
        context.performance.pendingInquiries = Math.max(0, (context.performance.pendingInquiries || 0) - 1);
        context.performance.responseRate = 100;
      }
    }

    await context.save();

    // 3. Create Message
    const newMessage = new Message({
      conversationId: conversation._id,
      sender: senderId,
      receiver: receiverId,
      content,
      contextType: finalContextType,
      contextId: finalContextId,
    });

    const savedMessage = await newMessage.save();

    // 4. Update Conversation
    conversation.lastMessage = savedMessage._id;
    const currentUnread = conversation.unreadCount.get(receiverId.toString()) || 0;
    conversation.unreadCount.set(receiverId.toString(), currentUnread + 1);

    await conversation.save();

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: savedMessage,
    });
  } catch (err) {
    console.error("[SEND MESSAGE ERROR]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📋 Get All Conversations for User
const getConversations = async (req, res) => {
  const userId = req.user.id;
  const { role } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  try {
    const staffInvites = await StaffInvitation.find({
      staff: userId,
      status: "ACCEPTED",
      permissions: "CUSTOMER_CARE"
    }).select("listings.listingId");

    const coHostInvites = await CoHostInvitation.find({
      coHost: userId,
      status: "ACCEPTED",
      permissions: "CUSTOMER_CARE"
    }).select("listings.listingId");

    const directCoHostEventCenters = await EventCenter.find({ coHosts: userId }).select("_id");
    const directCoHostEvents = await Event.find({ coHosts: userId }).select("_id");

    const agentListingIds = [];
    staffInvites.forEach(inv => inv.listings.forEach(l => agentListingIds.push(l.listingId)));
    coHostInvites.forEach(inv => inv.listings.forEach(l => agentListingIds.push(l.listingId)));
    directCoHostEventCenters.forEach(center => agentListingIds.push(center._id));
    directCoHostEvents.forEach(evt => agentListingIds.push(evt._id));

    const conversations = await Conversation.find({
      $or: [
        { participants: userId },
        { contextId: { $in: agentListingIds } }
      ]
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
      .sort({ updatedAt: -1 })
      .lean();

    let filteredConversations = conversations;

    if (role === 'organiser') {
      filteredConversations = conversations.filter(conv => {
        if (!conv.contextId) return false;
        const isOwner = conv.contextId.createdBy && conv.contextId.createdBy.toString() === userId.toString();
        if (isOwner) return true;
        const isAgent = agentListingIds.some(id => id.toString() === conv.contextId._id.toString());
        return isAgent;
      });
    } else if (role === 'user') {
      filteredConversations = conversations.filter(conv => {
        if (!conv.contextId) return false;
        const isOwner = conv.contextId.createdBy && conv.contextId.createdBy.toString() === userId.toString();
        const isAgent = agentListingIds.some(id => id.toString() === conv.contextId._id.toString());
        return !isOwner && !isAgent;
      });
    }

    // Apply pagination after filtering
    const total = filteredConversations.length;
    const skip = (page - 1) * limit;
    const paginatedConversations = filteredConversations.slice(skip, skip + limit);

    res.json({
      success: true,
      message: "Conversations fetched successfully",
      data: paginatedConversations,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[GET CONVERSATIONS ERROR]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 💬 Get Messages for a Conversation
const getMessages = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  try {
    const [messages, total] = await Promise.all([
      Message.find({ conversationId })
        .sort({ createdAt: -1 }) // Newest first for efficient pagination
        .skip(skip)
        .limit(limit)
        .populate("sender", "firstName surname profilePicture")
        .populate("receiver", "firstName surname profilePicture")
        .lean(),
      Message.countDocuments({ conversationId }),
    ]);

    // Mark messages as read for the current user
    await Message.updateMany(
      { conversationId, receiver: userId, read: false },
      { $set: { read: true } }
    );

    // Reset unread count for current user in conversation
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      conversation.unreadCount.set(userId.toString(), 0);
      await conversation.save();
    }

    res.json({
      success: true,
      message: "Messages fetched successfully",
      data: messages.reverse(), // Return in chronological order
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[GET MESSAGES ERROR]", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  sendMessage,
  getConversations,
  getMessages,
};
