/**
 * Migration Script: Rename coHost-related fields to coOrganiser
 *
 * Run this ONCE against your MongoDB database before deploying the updated code.
 *
 * Usage:
 *   node scripts/migrate-cohost-to-coorganiser.js
 *
 * Make sure MONGODB_URI is set in your environment or .env file.
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL || process.env.DATABASE_URI;

if (!MONGO_URI) {
  console.error("ERROR: MONGO_URI, DATABASE_URL, or DATABASE_URI not set in .env");
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  console.log("Connected to MongoDB. Starting migration...\n");

  // 1. Rename coHosts → coOrganisers in events collection
  const eventsResult = await db.collection("events").updateMany(
    { coHosts: { $exists: true } },
    { $rename: { coHosts: "coOrganisers" } }
  );
  console.log(`events: ${eventsResult.modifiedCount} documents renamed (coHosts → coOrganisers)`);

  // 2. Rename coHosts → coOrganisers in eventcenters collection
  const centersResult = await db.collection("eventcenters").updateMany(
    { coHosts: { $exists: true } },
    { $rename: { coHosts: "coOrganisers" } }
  );
  console.log(`eventcenters: ${centersResult.modifiedCount} documents renamed (coHosts → coOrganisers)`);

  // 3. Rename fields in cohostinvitations collection
  //    coHostEmail → coOrganiserEmail
  //    coHost → coOrganiser
  const inviteEmailResult = await db.collection("cohostinvitations").updateMany(
    { coHostEmail: { $exists: true } },
    { $rename: { coHostEmail: "coOrganiserEmail" } }
  );
  console.log(`cohostinvitations: ${inviteEmailResult.modifiedCount} documents renamed (coHostEmail → coOrganiserEmail)`);

  const inviteHostResult = await db.collection("cohostinvitations").updateMany(
    { coHost: { $exists: true } },
    { $rename: { coHost: "coOrganiser" } }
  );
  console.log(`cohostinvitations: ${inviteHostResult.modifiedCount} documents renamed (coHost → coOrganiser)`);

  // 4. Rename type in notifications collection
  //    COHOST_INVITATION → CO_ORGANISER_INVITATION
  const notificationTypeResult = await db.collection("notifications").updateMany(
    { type: "COHOST_INVITATION" },
    { $set: { type: "CO_ORGANISER_INVITATION" } }
  );
  console.log(`notifications: ${notificationTypeResult.modifiedCount} documents renamed (COHOST_INVITATION → CO_ORGANISER_INVITATION)`);

  console.log("\nMigration complete!");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
