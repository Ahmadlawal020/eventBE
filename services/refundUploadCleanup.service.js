const mongoose = require("mongoose");
const Attempts = require("../models/client/refundUploadAttempt.schema");
const Refund = require("../models/client/eventRefund.schema");
const cloudinary = require("../utils/cloudinary");
async function cleanupRefundUploads({ limit = 100 } = {}) {
  const candidates = await Attempts.find({
    state: { $ne: "DELETED" },
    cleanupAfter: { $lte: new Date() },
  })
    .sort({ cleanupAfter: 1 })
    .limit(limit)
    .lean();
  let deleted = 0,
    failed = 0;
  for (const candidate of candidates) {
    try {
      const claimed = await mongoose.connection.transaction(async (session) => {
        const attempt = await Attempts.findOneAndUpdate(
          {
            _id: candidate._id,
            state: { $ne: "DELETED" },
            expiresAt: { $lte: new Date() },
            cleanupAfter: { $lte: new Date() },
          },
          {
            $set: {
              state: "CLEANING",
              cleanupAfter: new Date(Date.now() + 600000),
            },
          },
          { new: true, session },
        );
        if (!attempt) return false;
        // Serialize against attachment and recovery. Never delete current or archived evidence.
        const retained = await Refund.exists({
          $or: [
            { "receipt.publicId": attempt.publicId },
            { "recoveryHistory.receipt.publicId": attempt.publicId },
          ],
        }).session(session);
        if (retained) {
          await Attempts.updateOne(
            { _id: attempt._id },
            {
              $set: {
                state: "ATTACHED",
                cleanupAfter: new Date(Date.now() + 86400000),
              },
            },
            { session },
          );
          return false;
        }
        await Refund.updateOne(
          { _id: attempt.refundId, pendingReceiptPublicId: attempt.publicId },
          { $unset: { pendingReceiptPublicId: 1 } },
          { session },
        );
        return true;
      });
      if (!claimed) continue;
      const result = await cloudinary.uploader.destroy(candidate.publicId, {
        type: "authenticated",
        resource_type: "image",
      });
      if (!["ok", "not found"].includes(result?.result))
        throw Error("Storage did not confirm deletion");
      await Attempts.updateOne(
        { _id: candidate._id, state: "CLEANING" },
        { $set: { state: "DELETED", lastError: null } },
      );
      deleted++;
    } catch (error) {
      failed++;
      await Attempts.updateOne(
        { _id: candidate._id },
        {
          $set: {
            lastError: String(error.message).slice(0, 500),
            cleanupAfter: new Date(Date.now() + 3600000),
          },
        },
      );
    }
  }
  return { deleted, failed };
}
module.exports = { cleanupRefundUploads };
