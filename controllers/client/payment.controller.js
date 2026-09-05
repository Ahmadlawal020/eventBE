const { getPaymentGateway } = require("../../services/payment");

const gateway = getPaymentGateway();

// ===================== INITIALIZE =====================
const initializePayment = async (req, res) => {
  const { email, amount, metadata, callback_url } = req.body;

  try {
    const data = await gateway.initializePayment({
      email,
      amount,
      metadata,
      callbackUrl: callback_url,
    });

    res.status(200).json({
      success: true,
      message: "Payment initialized",
      data,
    });
  } catch (err) {
    console.error("[PAYMENT INIT ERROR]", err.message);
    res.status(500).json({
      success: false,
      message: "Could not initialize payment",
    });
  }
};

// ===================== VERIFY (GENERAL) =====================
const verifyPayment = async (req, res) => {
  const { reference } = req.params;

  try {
    const data = await gateway.verifyPayment(reference);

    res.status(200).json({
      success: true,
      message: "Payment verified",
      data,
    });
  } catch (err) {
    console.error("[PAYMENT VERIFY ERROR]", err.message);
    res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
};
