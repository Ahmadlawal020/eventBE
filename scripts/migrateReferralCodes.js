/**
 * Migration: Shorten existing 21-char referral codes to 8-char codes.
 *
 * Run once with:
 *   node scripts/migrateReferralCodes.js
 *
 * Safe to re-run — skips users already on short codes.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/client/user.schema");
const { codeForUser } = require("../utils/referralCode");

const MONGO_URI = process.env.DATABASE_URI;

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  // Find all users whose referral code is longer than 8 characters
  const users = await User.find({
    referralCode: { $exists: true, $ne: null, $ne: "" },
    $expr: { $gt: [{ $strLenCP: "$referralCode" }, 8] },
  }).select("_id referralCode").lean();

  console.log(`📋 Found ${users.length} user(s) with long referral codes.`);

  if (users.length === 0) {
    console.log("🎉 Nothing to migrate. All codes are already short.");
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  let skipped = 0;
  let collisions = 0;

  for (const user of users) {
    const newCode = codeForUser(user._id);

    // Check if the new 8-char code is already taken by a different user
    const conflict = await User.findOne({
      referralCode: newCode,
      _id: { $ne: user._id },
    }).select("_id").lean();

    if (conflict) {
      // Fallback: append last 2 chars of the old code to make it unique (still ≤8)
      const fallback = newCode.slice(0, 6) + user.referralCode.slice(-2);
      console.warn(
        `⚠️  Collision for user ${user._id}: ${newCode} already taken. Using fallback: ${fallback}`
      );
      await User.updateOne({ _id: user._id }, { $set: { referralCode: fallback } });
      collisions++;
    } else {
      await User.updateOne({ _id: user._id }, { $set: { referralCode: newCode } });
      updated++;
    }

    console.log(`  ${user._id}: ${user.referralCode} → ${newCode}`);
  }

  console.log("\n--- Migration complete ---");
  console.log(`✅ Updated : ${updated}`);
  console.log(`⚠️  Collisions (fallback used): ${collisions}`);
  console.log(`⏭️  Skipped : ${skipped}`);

  await mongoose.disconnect();
  console.log("🔌 Disconnected.");
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
