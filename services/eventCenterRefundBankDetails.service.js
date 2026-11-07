function normalizeRefundBankDetails(body = {}) {
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.replace(/[\s-]/g, "") : "";
  const bankCode = typeof body.bankCode === "string" ? body.bankCode.trim() : "";
  const invalid = (field, message) => { throw Object.assign(new Error(message), { statusCode: 400, field }); };
  if (!accountName || accountName.length > 150) invalid("accountName", "Enter the account holder's name (up to 150 characters).");
  if (!/^[0-9]{6,34}$/.test(accountNumber)) invalid("accountNumber", "Enter an account number containing 6 to 34 digits. Keep any leading zeros.");
  if (!/^[A-Za-z0-9-]{2,20}$/.test(bankCode)) invalid("bankCode", "Select your bank or enter its bank code, not the bank name.");
  return { accountName, accountNumber, bankCode };
}
module.exports = { normalizeRefundBankDetails };
