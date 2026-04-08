const paystackService = require("../../services/paystack.service");

// ===================== INITIALIZE =====================
const initializePayment = async (req, res) => {
  const { email, amount, metadata, callback_url } = req.body;

  try {
    const data = await paystackService.initializeTransaction({
      email,
      amount,
      metadata,
      callback_url,
    });

    res.status(200).json({
      success: true,
      message: "Payment initialized",
      data,
    });
  } catch (err) {
    console.error(" [PAYMENT INIT ERROR]", err.message);
    res.status(500).json({
      success: false,
      message: "Could not initialize payment",
      error: err.message,
    });
  }
};

// ===================== VERIFY (GENERAL) =====================
const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  try {
    const data = await paystackService.verifyTransaction(reference);

    res.status(200).json({
      success: true,
      message: "Payment verified",
      data,
    });
  } catch (err) {
    console.error(" [PAYMENT VERIFY ERROR]", err.message);
    res.status(500).json({
      success: false,
      message: "Payment verification failed",
      error: err.message,
    });
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
};
