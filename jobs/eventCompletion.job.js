const { CronJob } = require("cron");
const Event = require("../models/client/event.schema");
const { getEventSettings } = require("../services/eventSettings.service");

/**
 * Mark past events as COMPLETED
 *
 * Replaces the expensive pre-find hook that ran updateMany on every Event.find() call.
 * This cron job runs every 15 minutes instead.
 */
const markCompletedEvents = async () => {
  try {
    const settings = await getEventSettings();
    if (!settings.lifecycle.autoCompletePastEvents) return;
    const completionCutoff = new Date(
      Date.now() - settings.lifecycle.completionGraceHours * 3600000,
    );
    const result = await Event.updateMany(
      {
        status: { $in: ["LISTED", "ACTION_REQUIRED", "UNLISTED"] },
        "schedule.to": { $lt: completionCutoff },
      },
      { $set: { status: "COMPLETED" } },
    );

    if (result.modifiedCount > 0) {
      console.log(
        `[Event Completion] Marked ${result.modifiedCount} event(s) as COMPLETED`,
      );
    }
  } catch (err) {
    console.error("[Event Completion] Error:", err);
  }
};

// Run every 15 minutes
const job = new CronJob("*/15 * * * *", markCompletedEvents, null, true, "UTC");

console.log("[Cron Job] Event Completion Job scheduled every 15 minutes.");

module.exports = job;
