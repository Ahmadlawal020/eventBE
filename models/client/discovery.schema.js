const { Schema, model } = require("mongoose");
const preferenceSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  enabled: { type: Boolean, default: true },
  revision: { type: Number, default: 0 },
  learnedSince: { type: Date, default: Date.now },
  eventTypes: { type: [String], default: [] },
  venueTypes: { type: [String], default: [] },
  city: { type: String, maxlength: 100, default: "" },
  countryCode: { type: String, maxlength: 2, default: "" },
  writeVersion: { type: Number, default: 0 },
}, { timestamps: true });
const behaviorSchema = new Schema({
  key: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  revision: { type: Number, required: true },
  type: { type: String, enum: ["impression", "click", "engaged", "dismiss", "save"], required: true },
  entityType: { type: String, enum: ["Event", "EventCenter"], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  occurrence: { type: Number, default: 0 },
  requestId: String,
  source: { type: String, enum: ["client", "server"], required: true },
  occurredAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
behaviorSchema.index({ userId: 1, revision: 1, occurredAt: -1 });
behaviorSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const requestSchema = new Schema({
  requestId: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  revision: Number,
  algorithmVersion: { type: String, required: true },
  entries: [{
    _id: false, entityId: Schema.Types.ObjectId,
    entityType: { type: String, enum: ["Event", "EventCenter"] },
    occurrence: Number, section: String, position: Number,
  }],
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
requestSchema.index({ userId: 1, createdAt: -1 });
requestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = {
  Preference: model("DiscoveryPreference", preferenceSchema),
  Behavior: model("DiscoveryBehavior", behaviorSchema),
  FeedRequest: model("DiscoveryRequest", requestSchema),
};
