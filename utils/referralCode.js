// Produces a stable, exactly-8-character referral code per user.
// "MN" prefix (2 chars) + last 6 uppercase base-36 digits of the ObjectId = 8 chars total.
const codeForUser = (id) =>
  "MN" + BigInt("0x" + String(id)).toString(36).toUpperCase().slice(-6);
module.exports = { codeForUser };
