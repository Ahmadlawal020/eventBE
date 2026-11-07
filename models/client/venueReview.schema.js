const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenterBooking", required: true, unique: true },
  venue: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenter", required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  authorName: String, rating: { type: Number, required: true, min: 1, max: 5 },
  reviewText: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ["APPROVED", "FLAGGED", "HIDDEN"], default: "APPROVED" },
  moderation: [{ _id: false, actor: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" }, status: String, at: Date }],
}, { timestamps: true });
module.exports = mongoose.model("VenueReview", schema);
