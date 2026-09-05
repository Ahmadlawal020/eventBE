const mongoose = require("mongoose");
const { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES } = require("../../constants/notificationTypes");

const channelDeliverySchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: ["in_app", "push", "email", "sms"],
      required: true,
    },
    status: {
      type: String,
      enum: ["SENT", "FAILED", "SKIPPED"],
      default: "SENT",
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },
    category: {
      type: String,
      enum: Object.values(NOTIFICATION_CATEGORIES),
      default: NOTIFICATION_CATEGORIES.SYSTEM,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    referenceType: {
      type: String,
      enum: [
        "Event",
        "EventCenter",
        "EventBooking",
        "EventCenterBooking",
        "UserEventTicket",
        "CoOrganiserInvitation",
        "StaffInvitation",
        "TicketTransferRequest",
        "Conversation",
        "ReferralEarning",
        "Custom",
        null,
      ],
      default: null,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    channelsDelivered: {
      type: [channelDeliverySchema],
      default: () => [],
    },
  },
  { timestamps: true }
);

// Indexes for lightning fast querying and pagination
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, category: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);

