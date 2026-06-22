const axios = require("axios");
const crypto = require("crypto");
const PaymentGateway = require("../paymentGateway.interface");

class PaystackAdapter extends PaymentGateway {
  constructor() {
    super();
    this.secretKey = process.env.PAYMENT_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY;
    this.baseUrl = "https://api.paystack.co";
  }

  get name() {
    return "paystack";
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      "Content-Type": "application/json",
    };
  }

  _ensureKey() {
    if (!this.secretKey) {
      throw new Error("PAYMENT_SECRET_KEY (or PAYSTACK_SECRET_KEY) is not set in environment variables.");
    }
  }

  // ────────────────────────────────────────────────────────────────
  // CORE PAYMENT
  // ────────────────────────────────────────────────────────────────

  async initializePayment({ email, amount, reference, metadata, subaccount, callbackUrl }) {
    this._ensureKey();

    const response = await axios.post(
      `${this.baseUrl}/transaction/initialize`,
      {
        email,
        amount: Math.round(amount * 100), // Convert to kobo
        reference,
        callback_url: callbackUrl,
        metadata,
        subaccount: subaccount || undefined,
      },
      { headers: this._headers() }
    );

    if (!response.data.status) {
      throw new Error(response.data.message || "Payment initialization failed.");
    }

    return response.data.data;
  }

  async verifyPayment(reference) {
    this._ensureKey();

    const response = await axios.get(
      `${this.baseUrl}/transaction/verify/${reference}`,
      { headers: this._headers() }
    );

    if (!response.data.status) {
      throw new Error(response.data.message || "Payment verification failed.");
    }

    return response.data.data;
  }

  async refundPayment(reference) {
    this._ensureKey();

    const response = await axios.post(
      `${this.baseUrl}/refund`,
      { transaction: reference },
      { headers: this._headers() }
    );

    if (!response.data.status) {
      throw new Error(response.data.message || "Refund failed.");
    }

    return response.data.data;
  }

  // ────────────────────────────────────────────────────────────────
  // SPLIT PAYMENTS / VENDOR ACCOUNTS
  // ────────────────────────────────────────────────────────────────

  async createVendorAccount({ businessName, bankCode, accountNumber, platformFeePercent = 10 }) {
    this._ensureKey();

    const response = await axios.post(
      `${this.baseUrl}/subaccount`,
      {
        business_name: businessName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: platformFeePercent,
      },
      { headers: this._headers() }
    );

    if (!response.data.status) {
      throw new Error(response.data.message || "Vendor account creation failed.");
    }

    return {
      vendorCode: response.data.data.subaccount_code,
      accountName: response.data.data.account_name || businessName,
    };
  }

  async deactivateVendorAccount(vendorCode) {
    this._ensureKey();

    const response = await axios.put(
      `${this.baseUrl}/subaccount/${vendorCode}`,
      { active: false },
      { headers: this._headers() }
    );

    if (!response.data.status) {
      throw new Error(response.data.message || "Vendor account deactivation failed.");
    }

    return { status: "deactivated" };
  }

  // ────────────────────────────────────────────────────────────────
  // BANKING
  // ────────────────────────────────────────────────────────────────

  async getBanks(country = "nigeria") {
    this._ensureKey();

    const response = await axios.get(
      `${this.baseUrl}/bank?country=${country}`,
      { headers: this._headers() }
    );

    return response.data.data;
  }

  async resolveBankAccount(accountNumber, bankCode) {
    this._ensureKey();

    const response = await axios.get(
      `${this.baseUrl}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      { headers: this._headers() }
    );

    return response.data.data;
  }

  // ────────────────────────────────────────────────────────────────
  // WEBHOOK
  // ────────────────────────────────────────────────────────────────

  validateWebhookSignature(rawBody, headers) {
    this._ensureKey();

    const hash = crypto
      .createHmac("sha512", this.secretKey)
      .update(rawBody)
      .digest("hex");

    return hash === headers["x-paystack-signature"];
  }

  parseWebhookEvent(body) {
    const { event, data } = body;
    const { reference, status, amount, currency, customer, metadata } = data || {};

    return {
      event,                          // e.g., 'charge.success'
      reference,                      // Transaction reference
      status,                         // 'success', 'failed', etc.
      amount: amount ? amount / 100 : 0, // Convert from kobo to main unit
      currency: currency || "NGN",
      customer: {
        email: customer?.email || "",
        name: customer?.first_name ? `${customer.first_name} ${customer.last_name || ""}`.trim() : "",
      },
      metadata: metadata || {},
      gateway: "paystack",
      rawEvent: body,
    };
  }
}

module.exports = PaystackAdapter;
