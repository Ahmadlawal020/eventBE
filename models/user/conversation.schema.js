const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
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
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
    isReplied: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Index for quick lookup of conversations for a user
conversationSchema.index({ participants: 1 });
// Index for conversations by context
conversationSchema.index({ contextId: 1, contextType: 1 });
// Compound index for duplicate conversation prevention check
conversationSchema.index({ participants: 1, contextType: 1, contextId: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
