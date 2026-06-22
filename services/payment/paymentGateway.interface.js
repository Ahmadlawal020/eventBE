/**
 * Payment Gateway Interface
 *
 * Abstract base class that all payment gateway adapters must implement.
 * This ensures a consistent API across different payment providers.
 *
 * All amounts are passed in the smallest currency unit (kobo, cents, etc.)
 * unless otherwise specified.
 */

class PaymentGateway {
  /**
   * Initialize a payment session.
   * Returns gateway-specific data needed to render the checkout (e.g., authorization_url).
   *
   * @param {Object} params
   * @param {string} params.email - Customer email
   * @param {number} params.amount - Amount in main currency unit (e.g., 5000 for ₦5,000)
   * @param {string} params.reference - Unique transaction reference
   * @param {Object} [params.metadata] - Arbitrary metadata to attach to the transaction
   * @param {string} [params.subaccount] - Vendor subaccount code for split payments
   * @param {string} [params.callbackUrl] - URL to redirect after payment
   * @returns {Promise<{authorization_url: string, access_code?: string, reference: string}>}
   */
  async initializePayment({ email, amount, reference, metadata, subaccount, callbackUrl }) {
    throw new Error("initializePayment() not implemented");
  }

  /**
   * Verify a transaction by reference.
   * Returns normalized transaction data.
   *
   * @param {string} reference - Transaction reference
   * @returns {Promise<NormalizedTransaction>}
   */
  async verifyPayment(reference) {
    throw new Error("verifyPayment() not implemented");
  }

  /**
   * Initiate a refund for a completed transaction.
   *
   * @param {string} reference - Transaction reference to refund
   * @returns {Promise<{status: string, refundId: string}>}
   */
  async refundPayment(reference) {
    throw new Error("refundPayment() not implemented");
  }

  /**
   * Create a vendor/merchant account for split payments.
   *
   * @param {Object} params
   * @param {string} params.businessName - Business or individual name
   * @param {string} params.bankCode - Bank code
   * @param {string} params.accountNumber - Bank account number
   * @param {number} [params.platformFeePercent=10] - Platform commission percentage
   * @returns {Promise<{vendorCode: string, accountName: string}>}
   */
  async createVendorAccount({ businessName, bankCode, accountNumber, platformFeePercent }) {
    throw new Error("createVendorAccount() not implemented");
  }

  /**
   * Deactivate a vendor/merchant account.
   *
   * @param {string} vendorCode - Vendor account code to deactivate
   * @returns {Promise<{status: string}>}
   */
  async deactivateVendorAccount(vendorCode) {
    throw new Error("deactivateVendorAccount() not implemented");
  }

  /**
   * Fetch list of supported banks.
   *
   * @param {string} [country='nigeria'] - Country code
   * @returns {Promise<Array<{name: string, code: string, id: number}>>}
   */
  async getBanks(country = "nigeria") {
    throw new Error("getBanks() not implemented");
  }

  /**
   * Resolve/validate a bank account number.
   *
   * @param {string} accountNumber - Bank account number
   * @param {string} bankCode - Bank code
   * @returns {Promise<{account_number: string, account_name: string, bank_id: number}>}
   */
  async resolveBankAccount(accountNumber, bankCode) {
    throw new Error("resolveBankAccount() not implemented");
  }

  /**
   * Validate a webhook request signature.
   *
   * @param {Buffer|string} rawBody - Raw request body
   * @param {Object} headers - Request headers
   * @returns {boolean} True if signature is valid
   */
  validateWebhookSignature(rawBody, headers) {
    throw new Error("validateWebhookSignature() not implemented");
  }

  /**
   * Parse a raw webhook event into a normalized structure.
   *
   * @param {Object} body - Parsed webhook request body
   * @returns {NormalizedWebhookEvent}
   */
  parseWebhookEvent(body) {
    throw new Error("parseWebhookEvent() not implemented");
  }

  /**
   * Get the gateway name identifier.
   * @returns {string}
   */
  get name() {
    throw new Error("name getter not implemented");
  }
}

/**
 * @typedef {Object} NormalizedTransaction
 * @property {string} reference - Transaction reference
 * @property {string} status - 'success' | 'failed' | 'pending' | 'abandoned'
 * @property {number} amount - Amount in smallest currency unit (kobo/cents)
 * @property {string} currency - Currency code (e.g., 'NGN')
 * @property {Object} customer - { email, name? }
 * @property {Object} metadata - Original metadata passed during initialization
 * @property {string} gateway - Gateway identifier (e.g., 'paystack')
 * @property {Object} raw - Original gateway response
 */

/**
 * @typedef {Object} NormalizedWebhookEvent
 * @property {string} event - Event type (e.g., 'charge.success', 'charge.failed')
 * @property {string} reference - Transaction reference
 * @property {string} status - Transaction status
 * @property {number} amount - Amount in smallest currency unit
 * @property {string} currency - Currency code
 * @property {Object} customer - { email, name? }
 * @property {Object} metadata - Original metadata
 * @property {string} gateway - Gateway identifier
 * @property {Object} rawEvent - Original webhook payload
 */

module.exports = PaymentGateway;
