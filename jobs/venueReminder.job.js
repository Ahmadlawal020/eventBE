const run = () => require("../services/eventOperations.service").runWorker("venue-reminders", () => require("../services/venueReminders.service").runVenueReminders());
module.exports = { run };
