const { CronJob } = require("cron");
const Event = require("../models/client/event.schema");
const { getEffectiveEventSettings: getEventSettings } = require("../services/eventSettings.service");

/**
 * Builds the MongoDB query filter for events that are past and eligible to be marked COMPLETED.
 *
 * @param {Date} completionCutoff - Cutoff date for events with explicit schedule.to (accounting for grace hours)
 * @param {Date} singleDayCutoff - Cutoff date for single-day events without schedule.to (accounts for standard 24h event window + grace hours)
 */
function buildCompletionFilter(completionCutoff, singleDayCutoff) {
  return {
    status: { $in: ["LISTED", "ACTION_REQUIRED", "UNLISTED"] },
    $or: [
      {
        "schedule.to": {
          $type: "date",
          $lt: completionCutoff,
        },
      },
      {
        $and: [
          {
            $or: [
              { "schedule.to": { $exists: false } },
              { "schedule.to": null },
              { "schedule.to": "" },
            ],
          },
          {
            "schedule.from": {
              $type: "date",
              $lt: singleDayCutoff,
            },
          },
        ],
      },
    ],
  };
}

/**
 * Mark past events as COMPLETED
 *
 * Replaces the expensive pre-find hook that ran updateMany on every Event.find() call.
 * This cron job runs every 15 minutes instead.
 */
const markCompletedEvents = async (options = {}) => {
  try {
    const EventModel = options.EventModel || Event;
    const settings = options.settingsOverride || (await getEventSettings());
    if (!settings?.lifecycle?.autoCompletePastEvents) {
      return { modifiedCount: 0 };
    }

    const now = options.now || new Date();
    const graceHours = Number(settings.lifecycle?.completionGraceHours) || 0;
    const completionCutoff = new Date(now.getTime() - graceHours * 3600000);

    // If an event has no explicit end time (single-day event where schedule.to is absent/null),
    // allocate 24 hours from the start date/time so it is not prematurely marked completed while still ongoing.
    const singleDayGraceMs = 24 * 3600000;
    const singleDayCutoff = new Date(completionCutoff.getTime() - singleDayGraceMs);

    const query = buildCompletionFilter(completionCutoff, singleDayCutoff);
    let result;
    if (options.EventModel) {
      result = await EventModel.updateMany(query, { $set: { status: "COMPLETED" } });
    } else {
      let modifiedCount = 0;
      const cursor = Event.find(query).select("_id").lean().cursor();
      for await (const event of cursor) {
        if (await require("../services/eventOccurrence.service").completeOccurrence(event._id, query)) modifiedCount++;
      }
      result = { modifiedCount };
    }

    if (result?.modifiedCount > 0) {
      console.log(
        `[Event Completion] Marked ${result.modifiedCount} event(s) as COMPLETED`,
      );
    }
    return result;
  } catch (err) {
    console.error("[Event Completion] Error:", err);
    throw err;
  }
};

// Run every 15 minutes (avoid auto-starting during unit tests to allow process exit)
const isTest = process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT || process.execArgv.includes("--test") || process.argv.includes("--test");
const job = new CronJob("*/15 * * * *", () => require("../services/eventOperations.service").runWorker("event-completion", markCompletedEvents).catch(error => console.error("[COMPLETION WORKER]", error.message)), null, !isTest, "UTC");

if (!isTest) {
  console.log("[Cron Job] Event Completion Job scheduled every 15 minutes.");
}

job.markCompletedEvents = markCompletedEvents;
job.buildCompletionFilter = buildCompletionFilter;

module.exports = job;

