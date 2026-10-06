const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  eventCenter: { type: mongoose.Schema.Types.ObjectId, ref: "EventCenter", required: true },
  bookingId: { type: String, required: true },
  checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  checkedInAt: { type: Date, default: Date.now, required: true },
  proofVerified: { type: Boolean, required: true },
});
// One check-in for the entire manual booking, including simultaneous requests.
schema.index({ eventCenter: 1, bookingId: 1 }, { unique: true });
module.exports = mongoose.model("ManualBookingCheckIn", schema);
