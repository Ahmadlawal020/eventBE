const run = () => require("../services/eventOperations.service").runWorker("refund-operations", () => require("../services/refundOperations.service").runRefundOperations());
module.exports = { run };
