const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  destinationHash: { type: String, required: true }, signature: String, alerts: [String], canary: Boolean,
  attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: () => new Date(0) }, lockToken: String,
  deliveredAt: Date, lastError: String,
}, { timestamps: true });
schema.index({ destinationHash: 1, deliveredAt: 1, nextAttemptAt: 1 });
module.exports = mongoose.model("OperationalAlert", schema);
