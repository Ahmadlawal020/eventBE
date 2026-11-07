// Purchase notices and history are committed in the payment transaction.
// Kept for compatibility with webhook/reconciliation callers.
async function notifyPaymentCompletion() {}
module.exports = { notifyPaymentCompletion };
