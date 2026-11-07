const run = () => require("../services/eventOperations.service").runWorker("notification-triggers", () => require("../services/notificationTriggers.service").runNotificationChecks());
module.exports = { run };
