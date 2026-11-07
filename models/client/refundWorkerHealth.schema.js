const mongoose = require("mongoose");
module.exports = mongoose.model(
  "RefundWorkerHealth",
  new mongoose.Schema(
    {
      name: { type: String, unique: true },
      startedAt: Date,
      nextRunAt: Date,
      revision: String,
      completedRevision: String,
      processId: Number,
      lockedUntil: Date,
      lockToken: String,
      heartbeatAt: Date,
      completedAt: Date,
      lastError: String,
      result: mongoose.Schema.Types.Mixed,
    },
    { timestamps: true },
  ),
);
