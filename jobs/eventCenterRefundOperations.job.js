const run = () => require("../services/eventOperations.service").runWorker("venue-refund-operations", () => require("../services/eventCenterRefundOperations.service").runRefundOperations());
module.exports = { run };
