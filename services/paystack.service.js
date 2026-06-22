/**
 * @deprecated Use `require("../../services/payment").getPaymentGateway()` instead.
 *
 * This file is a backward-compatible wrapper around the new payment adapter layer.
 * All new code should import from `services/payment` instead.
 */
const { getPaymentGateway } = require("./payment");

const gateway = getPaymentGateway("paystack");

const initializeTransaction = (data) => {
  return gateway.initializePayment({
    email: data.email,
    amount: data.amount,
    reference: data.reference,
    callbackUrl: data.callback_url,
    metadata: data.metadata,
    subaccount: data.subaccount,
  });
};

const verifyTransaction = (reference) => {
  return gateway.verifyPayment(reference);
};

const createSubaccount = (data) => {
  return gateway.createVendorAccount({
    businessName: data.business_name,
    bankCode: data.settlement_bank,
    accountNumber: data.account_number,
    platformFeePercent: data.percentage_charge || 10,
  });
};

const getBanks = () => {
  return gateway.getBanks("nigeria");
};

const resolveAccountNumber = (account_number, bank_code) => {
  return gateway.resolveBankAccount(account_number, bank_code);
};

const deactivateSubaccount = (subaccountCode) => {
  return gateway.deactivateVendorAccount(subaccountCode);
};

const refundTransaction = (reference) => {
  return gateway.refundPayment(reference);
};

const initiateTransfer = ({ amount, recipient, reference, reason }) => {
  // Not yet implemented in adapter — kept for backward compat
  throw new Error("initiateTransfer is not yet implemented in the payment adapter.");
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createSubaccount,
  getBanks,
  resolveAccountNumber,
  deactivateSubaccount,
  refundTransaction,
  initiateTransfer,
};
