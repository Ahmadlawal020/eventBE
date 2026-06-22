const { CronJob } = require("cron");
const Event = require("../models/user/event.schema");

/**
 * Mark past events as COMPLETED
 *
 * Replaces the expensive pre-find hook that ran updateMany on every Event.find() call.
 * This cron job runs every 15 minutes instead.
 */
const markCompletedEvents = async () => {
  try {
    const result = await Event.updateMany(
      {
        status: { $in: ["LISTED", "ACTION_REQUIRED", "UNLISTED"] },
        "schedule.to": { $lt: new Date() },
      },
      { $set: { status: "COMPLETED" } }
    );

    if (result.modifiedCount > 0) {
      console.log(`[Event Completion] Marked ${result.modifiedCount} event(s) as COMPLETED`);
    }
  } catch (err) {
    console.error("[Event Completion] Error:", err);
  }
};

// Run every 15 minutes
const job = new CronJob("*/15 * * * *", markCompletedEvents, null, true, "UTC");

console.log("[Cron Job] Event Completion Job scheduled every 15 minutes.");

module.exports = job;
