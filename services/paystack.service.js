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

module.exports = {
  initializeTransaction,
  verifyTransaction,
};
