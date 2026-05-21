const axios = require("axios");

const initializeTransaction = async (data) => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not set in environment variables.");
  }

  const response = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      email: data.email,
      amount: Math.round(data.amount * 100), // Convert to kobo
      reference: data.reference,
      callback_url: data.callback_url,
      metadata: data.metadata,
      subaccount: data.subaccount,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.data.status) {
    throw new Error(response.data.message || "Paystack initialization failed.");
  }

  return response.data.data;
};

const verifyTransaction = async (reference) => {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not set in environment variables.");
  }

  const response = await axios.get(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    }
  );

  if (!response.data.status) {
    throw new Error(response.data.message || "Payment verification failed.");
  }

  // Return full transaction data (status can be 'success', 'abandoned', 'pending', etc.)
  return response.data.data;
};

// Subaccounts and Bank Transfer methods
const createSubaccount = async (data) => {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY missing");
  const response = await axios.post(
    "https://api.paystack.co/subaccount",
    {
      business_name: data.business_name,
      settlement_bank: data.settlement_bank,
      account_number: data.account_number,
      percentage_charge: data.percentage_charge || 10, // Default 10% platform fee
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!response.data.status) throw new Error(response.data.message || "Subaccount creation failed.");
  return response.data.data;
};

const getBanks = async () => {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY missing");
  const response = await axios.get("https://api.paystack.co/bank?country=nigeria", {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  return response.data.data;
};

const resolveAccountNumber = async (account_number, bank_code) => {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY missing");
  const response = await axios.get(
    `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
    {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    }
  );
  return response.data.data;
};

const deactivateSubaccount = async (subaccountCode) => {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY missing");
  const response = await axios.put(
    `https://api.paystack.co/subaccount/${subaccountCode}`,
    {
      active: false,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!response.data.status) throw new Error(response.data.message || "Subaccount deactivation failed.");
  return response.data.data;
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createSubaccount,
  getBanks,
  resolveAccountNumber,
  deactivateSubaccount,
};
