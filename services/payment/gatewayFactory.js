const PaystackAdapter = require("./adapters/paystack.adapter");

const adapters = {
  paystack: PaystackAdapter,
  // stripe: StripeAdapter,      // Future
  // flutterwave: FlutterwaveAdapter, // Future
};

/**
 * Get a payment gateway adapter instance.
 *
 * @param {string} [provider] - Gateway provider name. Defaults to PAYMENT_PROVIDER env var or 'paystack'.
 * @returns {PaymentGateway} Adapter instance
 */
const getPaymentGateway = (provider) => {
  const selectedProvider = (provider || process.env.PAYMENT_PROVIDER || "paystack").toLowerCase();

  const AdapterClass = adapters[selectedProvider];
  if (!AdapterClass) {
    throw new Error(
      `Unknown payment provider: "${selectedProvider}". Available: ${Object.keys(adapters).join(", ")}`
    );
  }

  return new AdapterClass();
};

module.exports = { getPaymentGateway };
