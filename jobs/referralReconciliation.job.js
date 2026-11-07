const { runWorker } = require("../services/eventOperations.service");
const run = () => runWorker("referral-reconciliation", () => require("../services/referralReconciliation.service").reconcileReferrals());
module.exports = { run };
