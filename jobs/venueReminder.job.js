const { CronJob } = require("cron");
let running = false;
module.exports = new CronJob("*/5 * * * *", async () => {
  if (running) return; running = true;
  try { await require("../services/venueReminders.service").runVenueReminders(); }
  catch (error) { console.error("[VENUE REMINDERS]", error.message); }
  finally { running = false; }
}, null, true, "UTC");
