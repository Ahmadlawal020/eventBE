// Only the four records explicitly identified by the user as development fixtures.
require("dotenv").config();
const mongoose = require("mongoose");
const expected = [
  ["6ac8f2d8c62c7354386f55e8", 1100000, "CONFIRMED_BY_BUYER"],
  ["6ac8f2d9c62c7354386f55f3", 3300000, "MARKED_PAID"],
  ["6ac8f2dac62c7354386f5602", 1100000, "CONFIRMED_BY_BUYER"],
  ["6ac8f2dbc62c7354386f560d", 3300000, "MARKED_PAID"],
];
async function main() {
  if ((process.env.NODE_ENV || "").toLowerCase() === "production" || !(process.env.PAYMENT_SECRET_KEY || "").startsWith("sk_test_")) throw Error("This cleanup is restricted to the development test-payment environment.");
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    const Refund = require("../models/client/eventRefund.schema"), Outbox = require("../models/client/notificationOutbox.schema");
    const ids = expected.map(([id]) => new mongoose.Types.ObjectId(id));
    const result = await mongoose.connection.transaction(async session => {
      const rows = await Refund.collection.find({ _id: { $in: ids } }, { session }).toArray();
      for (const row of rows) {
        const [, amount, status] = expected.find(([id]) => id === String(row._id));
        if (row.ticketId || row.currency !== "NGN" || row.amountMinor !== amount || row.status !== status) throw Error("A fixture changed; cleanup requires review.");
      }
      const noticeFilter = { "data.refundId": { $in: [...ids, ...ids.map(String)] }, completedAt: null };
      const notices = await Outbox.collection.find(noticeFilter, { session }).toArray();
      if (notices.some(row => row.lockedUntil && row.lockedUntil > new Date())) throw Error("A related notification is being delivered; retry after the worker finishes.");
      if (!process.argv.includes("--apply")) return { dryRun: true, matchedRefunds: rows.length, pendingNotices: notices.length, ids: rows.map(row => String(row._id)) };
      const backup = mongoose.connection.collection("development_refund_removal_backups");
      for (const row of rows) await backup.updateOne({ _id: row._id }, { $setOnInsert: { original: row, removedAt: new Date(), reason: "User confirmed these four records are development test data", pendingNotices: notices.filter(n => String(n.data?.refundId) === String(row._id)) } }, { upsert: true, session });
      if (notices.length) await Outbox.deleteMany({ _id: { $in: notices.map(row => row._id) } }, { session });
      const removed = await Refund.deleteMany({ _id: { $in: rows.map(row => row._id) } }, { session });
      return { dryRun: false, removedRefunds: removed.deletedCount, removedPendingNotices: notices.length, recoveryCollection: "development_refund_removal_backups" };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error("Development refund cleanup failed:", error.message); process.exitCode = 1; });
