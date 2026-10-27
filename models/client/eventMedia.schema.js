const { Schema, model } = require("mongoose");
const schema = new Schema({
  publicId: { type: String, required: true, unique: true },
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
  eventId: { type: Schema.Types.ObjectId, ref: "Event" },
  url: String,
  state: { type: String, enum: ["PENDING", "READY", "ATTACHED", "CLEANING", "DELETED"], default: "PENDING" },
  expiresAt: Date, cleanupAfter: Date, lastError: String,
}, { timestamps: true });
schema.index({ state: 1, cleanupAfter: 1 });
module.exports = model("EventMedia", schema);
