const { CronJob } = require("cron");
const { runWorker } = require("../services/eventOperations.service");
const { cleanupEventMedia } = require("../services/eventMedia.service");
const run = () => runWorker("event-media-cleanup", cleanupEventMedia)
  .catch(error => console.error("[EVENT MEDIA CLEANUP]", error.message));
const isTest = process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT;
const job = new CronJob("*/10 * * * *", run, null, !isTest, "UTC");
module.exports = { job, run };
