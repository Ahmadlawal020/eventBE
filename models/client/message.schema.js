const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    // Redundant but helpful context as requested
    contextType: {
      type: String,
      enum: ["Event", "EventCenter"],
      required: true,
    },
    contextId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "contextType",
      required: true,
    },
  },
  { timestamps: true }
);

// Index for paginated message retrieval within a conversation
messageSchema.index({ conversationId: 1, createdAt: -1 });
// Index for unread message queries
messageSchema.index({ receiver: 1, read: 1 });

module.exports = mongoose.model("Message", messageSchema);
