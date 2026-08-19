const Message = require("../../models/user/message.schema");
const Conversation = require("../../models/user/conversation.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");
const User = require("../../models/user/user.schema");
const { dispatchNotification, NOTIFICATION_TYPES } = require("../../services/notification");
const mongoose = require("mongoose");

// Helper function to check if a user is an authorized representative (Owner, Co-Organiser, or Staff with CUSTOMER_CARE permission)
const checkCustomerCareAccess = async (userId, listingId, listingType) => {
  try {
    if (!userId || !listingId) return false;

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

    // 2. Is an active Staff with customer care permission?
    const staffInvite = await StaffInvitation.findOne({
      staff: userId,
      "listings.listingId": listingId,
      status: "ACCEPTED",
      permissions: { $in: ["CUSTOMER_CARE", "MANAGE_CUSTOMER_CARE", "ALL_ACCESS"] },
    });
    if (staffInvite) return true;

    // 3. Is an active Co-Organiser?
    if (listing.coOrganisers && listing.coOrganisers.some((id) => id.toString() === userId.toString())) {
      return true;
    }

    const coOrganiserInvite = await CoOrganiserInvitation.findOne({
      coOrganiser: userId,
      "listings.listingId": listingId,
      status: "ACCEPTED",
      permissions: { $in: ["CUSTOMER_CARE", "MANAGE_CUSTOMER_CARE", "ALL_ACCESS"] },
    });
    if (coOrganiserInvite) return true;

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
      return res.status(404).json({ success: false, message: "Context listing not found" });
    }

    const organiserId = context.createdBy.toString();

    // Verify if sender has representative support/customer care access
    const isSenderRepresentative = await checkCustomerCareAccess(senderId, finalContextId, finalContextType);

    if (conversationId) {
      if (isSenderRepresentative) {
        // If host representative replies, recipient is the guest participant
        receiverId = conversation.participants.find(
          (p) => p && p.toString() !== organiserId && p.toString() !== senderId.toString()
        );
        if (!receiverId) {
          receiverId = conversation.participants.find((p) => p && p.toString() !== senderId.toString());
        }
      } else {
        // If guest sends message, recipient is the organiser
        receiverId = organiserId;
      }

      if (!receiverId && conversation.participants.length >= 2) {
        receiverId = conversation.participants[0].toString() === senderId.toString()
          ? conversation.participants[1]
          : conversation.participants[0];
      }
    } else {
      receiverId = organiserId;
      if (isSenderRepresentative) {
        return res.status(400).json({
          success: false,
          message: "Organisers, Co-Organisers, and Staff cannot start conversations with their own listings",
        });
      }

      conversation = await Conversation.findOne({
        participants: { $all: [senderId, receiverId] },
        contextType: finalContextType,
        contextId: finalContextId,
      });

      if (!conversation) {
        try {
          conversation = new Conversation({
            participants: [senderId, receiverId],
            contextType: finalContextType,
            contextId: finalContextId,
            isReplied: true,
          });
          await conversation.save();
          if (!context.performance) context.performance = {};
          context.performance.messages = (context.performance.messages || 0) + 1;
        } catch (err) {
          if (err.code === 11000) {
            conversation = await Conversation.findOne({
              participants: { $all: [senderId, receiverId] },
              contextType: finalContextType,
              contextId: finalContextId,
            });
          } else {
            throw err;
          }
        }
      }
    }

    if (!receiverId) {
      return res.status(400).json({ success: false, message: "Recipient could not be determined" });
    }

    // 2. Update Performance Tracking (Pending Inquiries & Response Rate)
    if (!context.performance) {
      context.performance = { messages: 0, pendingInquiries: 0, responseRate: 100 };
    }

    if (!isSenderRepresentative) {
      // Guest is sending a message
      if (conversation.isReplied) {
        conversation.isReplied = false;
        context.performance.pendingInquiries = (context.performance.pendingInquiries || 0) + 1;
      }
    } else {
      // Host representative (Owner, Co-Organiser, or Staff) is replying
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
      content: content.trim(),
      contextType: finalContextType,
      contextId: finalContextId,
    });

    const savedMessage = await newMessage.save();

    // 4. Update Conversation
    conversation.lastMessage = savedMessage._id;

    const unreadMap = conversation.unreadCount instanceof Map
      ? conversation.unreadCount
      : new Map(Object.entries(conversation.unreadCount || {}));
    const currentUnread = unreadMap.get(receiverId.toString()) || 0;
    unreadMap.set(receiverId.toString(), currentUnread + 1);
    conversation.unreadCount = unreadMap;

    await conversation.save();

    // 5. Dispatch Message Notification (Push & In-App)
    try {
      const senderUser = await User.findById(senderId).select("firstName surname profilePicture").lean();
      const senderName = `${senderUser?.firstName || ""} ${senderUser?.surname || ""}`.trim() || "Someone";
      const snippet = content.length > 80 ? `${content.substring(0, 80)}...` : content;

      await dispatchNotification({
        recipient: receiverId,
        sender: senderId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: `Message from ${senderName}`,
        message: snippet,
        referenceId: conversation._id,
        referenceType: "Conversation",
        data: {
          screen: "ChatScreen",
          conversationId: String(conversation._id),
          senderId: String(senderId),
        },
        priority: "high",
      });
    } catch (notifErr) {
      console.error("[MESSAGE NOTIFICATION ERROR]", notifErr);
    }

    const populatedMessage = await Message.findById(savedMessage._id)
      .populate("sender", "firstName surname profilePicture")
      .populate("receiver", "firstName surname profilePicture")
      .lean();

    res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: populatedMessage || savedMessage,
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
      permissions: { $in: ["CUSTOMER_CARE", "MANAGE_CUSTOMER_CARE", "ALL_ACCESS"] },
    }).select("listings.listingId");

    const coOrganiserInvites = await CoOrganiserInvitation.find({
      coOrganiser: userId,
      status: "ACCEPTED",
      permissions: { $in: ["CUSTOMER_CARE", "MANAGE_CUSTOMER_CARE", "ALL_ACCESS"] },
    }).select("listings.listingId");

    const directCoOrganiserEventCenters = await EventCenter.find({ coOrganisers: userId }).select("_id");
    const directCoOrganiserEvents = await Event.find({ coOrganisers: userId }).select("_id");
    const myOwnedEventCenters = await EventCenter.find({ createdBy: userId }).select("_id");
    const myOwnedEvents = await Event.find({ createdBy: userId }).select("_id");

    const agentListingIds = [];
    staffInvites.forEach((inv) => inv.listings.forEach((l) => agentListingIds.push(l.listingId.toString())));
    coOrganiserInvites.forEach((inv) => inv.listings.forEach((l) => agentListingIds.push(l.listingId.toString())));
    directCoOrganiserEventCenters.forEach((center) => agentListingIds.push(center._id.toString()));
    directCoOrganiserEvents.forEach((evt) => agentListingIds.push(evt._id.toString()));

    const ownedListingIds = [
      ...myOwnedEventCenters.map((c) => c._id.toString()),
      ...myOwnedEvents.map((e) => e._id.toString()),
    ];

    const allOrganiserListingIds = [...new Set([...agentListingIds, ...ownedListingIds])];

    const conversations = await Conversation.find({
      $or: [
        { participants: userId },
        { contextId: { $in: allOrganiserListingIds } },
      ],
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

    let filteredConversations = conversations;

    if (role === "organiser") {
      filteredConversations = conversations.filter((conv) => {
        if (!conv.contextId) return false;
        const convListingId = conv.contextId._id ? conv.contextId._id.toString() : conv.contextId.toString();
        const isOwner = conv.contextId.createdBy && conv.contextId.createdBy.toString() === userId.toString();
        if (isOwner) return true;
        return allOrganiserListingIds.includes(convListingId);
      });
    } else if (role === "user") {
      filteredConversations = conversations.filter((conv) => {
        if (!conv.contextId) return false;
        const convListingId = conv.contextId._id ? conv.contextId._id.toString() : conv.contextId.toString();
        const isOwner = conv.contextId.createdBy && conv.contextId.createdBy.toString() === userId.toString();
        const isAgent = allOrganiserListingIds.includes(convListingId);
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
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const isReaderRepresentative = await checkCustomerCareAccess(
      userId,
      conversation.contextId,
      conversation.contextType
    );

    const [messages, total] = await Promise.all([
      Message.find({ conversationId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sender", "firstName surname profilePicture")
        .populate("receiver", "firstName surname profilePicture")
        .lean(),
      Message.countDocuments({ conversationId }),
    ]);

    // Mark messages as read
    if (isReaderRepresentative) {
      // Mark all incoming guest messages as read
      await Message.updateMany(
        { conversationId, sender: { $ne: userId }, read: false },
        { $set: { read: true } }
      );
    } else {
      // Mark messages received by this user as read
      await Message.updateMany(
        { conversationId, receiver: userId, read: false },
        { $set: { read: true } }
      );
    }

    // Reset unread count for reader and owner
    const unreadMap = conversation.unreadCount instanceof Map
      ? conversation.unreadCount
      : new Map(Object.entries(conversation.unreadCount || {}));

    unreadMap.set(userId.toString(), 0);

    // If representative is reading, also clear listing owner unread count
    let contextListing;
    if (conversation.contextType === "Event") {
      contextListing = await Event.findById(conversation.contextId).select("createdBy");
    } else {
      contextListing = await EventCenter.findById(conversation.contextId).select("createdBy");
    }

    if (isReaderRepresentative && contextListing?.createdBy) {
      unreadMap.set(contextListing.createdBy.toString(), 0);
    }

    conversation.unreadCount = unreadMap;
    await conversation.save();

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
