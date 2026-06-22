/**
 * Migration Script: Rename Paystack-specific fields to gateway-agnostic names
 *
 * Run with: node scripts/migrate-payment-fields.js
 *
 * This script:
 * 1. Copies paystackSubaccountCode → vendorAccountCode on User documents
 * 2. Copies paystackReference → paymentReference on EventBooking documents
 * 3. Copies paystackReference → paymentReference on EventCenterTicket documents
 * 4. Updates paymentMethod from "PAYSTACK" → "CARD" on EventBooking documents
 *
 * Old fields are preserved during the migration period and can be removed later.
 */

const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL || process.env.DATABASE_URI;

if (!MONGO_URI) {
  console.error("ERROR: MONGO_URI, DATABASE_URL, or DATABASE_URI not set in .env");
  process.exit(1);
}

async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected.\n");

  const db = mongoose.connection.db;

  // ─── 1. User: paystackSubaccountCode → vendorAccountCode ─────────
  console.log("=== Migrating User.vendorAccountCode ===");
  const userResult = await db.collection("users").updateMany(
    {
      paystackSubaccountCode: { $exists: true, $ne: null },
      $or: [
        { vendorAccountCode: { $exists: false } },
        { vendorAccountCode: null },
      ],
    },
    [
      {
        $set: {
          vendorAccountCode: "$paystackSubaccountCode",
        },
      },
    ]
  );
  console.log(`  Updated ${userResult.modifiedCount} user documents\n`);

  // ─── 2. EventBooking: paystackReference → paymentReference ────────
  console.log("=== Migrating EventBooking.paymentReference ===");
  const bookingResult = await db.collection("eventbookings").updateMany(
    {
      paystackReference: { $exists: true, $ne: null },
      $or: [
        { paymentReference: { $exists: false } },
        { paymentReference: null },
      ],
    },
    [
      {
        $set: {
          paymentReference: "$paystackReference",
        },
      },
    ]
  );
  console.log(`  Updated ${bookingResult.modifiedCount} event booking documents\n`);

  // ─── 3. EventBooking: paymentMethod PAYSTACK → CARD ──────────────
  console.log("=== Migrating EventBooking.paymentMethod ===");
  const methodResult = await db.collection("eventbookings").updateMany(
    { paymentMethod: "PAYSTACK" },
    { $set: { paymentMethod: "CARD" } }
  );
  console.log(`  Updated ${methodResult.modifiedCount} event booking documents\n`);

  // ─── 4. EventCenterTicket: paystackReference → paymentReference ──
  console.log("=== Migrating EventCenterTicket.paymentReference ===");
  const ticketResult = await db.collection("eventcentertickets").updateMany(
    {
      paystackReference: { $exists: true, $ne: null },
      $or: [
        { paymentReference: { $exists: false } },
        { paymentReference: null },
      ],
    },
    [
      {
        $set: {
          paymentReference: "$paystackReference",
        },
      },
    ]
  );
  console.log(`  Updated ${ticketResult.modifiedCount} event center ticket documents\n`);

  // ─── Summary ─────────────────────────────────────────────────────
  console.log("=== Migration Complete ===");
  console.log(`  Users updated:              ${userResult.modifiedCount}`);
  console.log(`  EventBookings ref updated:  ${bookingResult.modifiedCount}`);
  console.log(`  EventBookings method fixed: ${methodResult.modifiedCount}`);
  console.log(`  EventCenterTickets updated: ${ticketResult.modifiedCount}`);
  console.log("\nOld fields are preserved. You can remove them later with:");
  console.log('  db.users.updateMany({}, { $unset: { paystackSubaccountCode: "" } })');
  console.log('  db.eventbookings.updateMany({}, { $unset: { paystackReference: "" } })');
  console.log('  db.eventcentertickets.updateMany({}, { $unset: { paystackReference: "" } })');

  await mongoose.disconnect();
  console.log("\nDisconnected from MongoDB.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
