const mongoose = require("mongoose");

const BLOCKED = ["UNLISTED", "CANCELLED"];
module.exports = function listingModeration(schema) {
  schema.add({
    moderation: {
      status: { type: String, enum: ["PENDING", "APPROVED", ...BLOCKED], default: "PENDING" },
      reason: { type: String, maxlength: 2000 },
      reviewedAt: Date,
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      history: [{
        decision: String,
        reason: String,
        previousStatus: String,
        listingStatus: String,
        reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now },
      }],
    },
  });
  schema.path("moderation.history").select(false);
  schema.index({ "moderation.status": 1, status: 1, createdAt: -1 });
  // Covers organiser updates, verification sync and legacy admin status endpoints.
  schema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function () {
    const update = this.getUpdate() || {};
    const values = { ...update, ...update.$set };
    if (values.status && values.status !== "UNLISTED" &&
        !["APPROVED", "UNLISTED", "CANCELLED"].includes(values["moderation.status"])) {
      this.where({ "moderation.status": { $nin: BLOCKED } });
    }
  });
  schema.pre("validate", function () {
    if (this.isModified("status") && this.status !== "UNLISTED" && BLOCKED.includes(this.moderation?.status)) {
      this.invalidate("status", "A moderator must restore this listing before it can be published.");
    }
  });
};
