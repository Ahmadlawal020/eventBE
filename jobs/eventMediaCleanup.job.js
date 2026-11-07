const run = () => require("../services/eventOperations.service").runWorker("event-media-cleanup", () => require("../services/eventMedia.service").cleanupEventMedia());
module.exports = { run };
