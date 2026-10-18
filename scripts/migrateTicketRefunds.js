// Run with the matching server release. Default: read-only report.
// --apply backs up each original record and migrates it in one transaction.
require("dotenv").config();
const mongoose = require("mongoose");
const Refund = require("../models/client/eventRefund.schema");
const { planLegacyRefund, migrateLegacyRefund } = require("../services/migrateTicketRefunds.service");
async function main() {
  if (!process.env.DATABASE_URI) throw new Error("DATABASE_URI is not configured");
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const apply = process.argv.includes("--apply");
  if (apply) {
    // Replace only the obsolete one-per-order uniqueness constraint.
    await Refund.collection.createIndex({ eventId: 1, bookingId: 1, ticketId: 1 }, { unique: true });
    await Refund.collection.createIndex({ ticketId: 1 }, { unique: true, partialFilterExpression: { ticketId: { $type: "objectId" } } });
    const indexes = await Refund.collection.indexes();
    const old = indexes.find(index => index.unique && Object.keys(index.key).length === 2 && index.key.eventId === 1 && index.key.bookingId === 1);
    if (old) await Refund.collection.dropIndex(old.name);
  }
  for await (const refund of Refund.find({ ticketId: null }).select("_id").lean().cursor()) {
    try {
      const rows = apply ? await migrateLegacyRefund(refund._id) : (await planLegacyRefund(refund._id, null))?.length || 0;
      console.log(JSON.stringify({ refundId: String(refund._id), action: apply ? "migrated" : "ready", tickets: rows }));
    } catch (error) { console.log(JSON.stringify({ refundId: String(refund._id), action: "manual_review", reason: error.message })); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
