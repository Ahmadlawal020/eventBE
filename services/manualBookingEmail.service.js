const crypto = require("crypto");
const Operations = require("../models/client/bookingOperations.schema");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const escape = value => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

async function queueBookingCode({ venue, bookingId, email, name }, session) {
  const address = String(email || "").trim();
  if (!address) return;
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw Object.assign(new Error("Enter a valid customer email address to receive the booking code."), { status: 400 });
  }
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const operationsId = `${venue._id}:${bookingId}`;
  const result = await Operations.updateOne({ _id: operationsId, customerId: null }, {
    $set: { claimHash: hash(token), claimExpiresAt: expiresAt },
  }, { session });
  if (!result.matchedCount) return;
  await require("./eventCenterRefundNotifications.service").queueNotices([{
    key: `manual-booking-code:${operationsId}`,
    type: "SYSTEM", title: "Your private venue booking code", message: "Link your direct venue booking in Munasaba.",
    manualBookingClaim: { email: address, name, venueName: venue.venueName, bookingId, operationsId, token, expiresAt },
  }], session);
}

async function deliverBookingCode(notice) {
  const claim = notice.manualBookingClaim;
  const record = await Operations.findOne({ _id: claim.operationsId, customerId: null,
    claimHash: hash(claim.token), claimExpiresAt: { $gt: new Date() } }).lean();
  // A redeemed, replaced or expired code must not be emailed by a delayed retry.
  if (!record) return false;
  const result = await require("./email.service").sendEmail({
    to: claim.email, subject: "Your private venue booking code",
    html: `<p>Hello ${escape(claim.name || "there")},</p><p>Your booking with <strong>${escape(claim.venueName)}</strong> has been recorded.</p><p>Booking reference: ${escape(claim.bookingId)}</p><p>Your private booking code:</p><p style="font-family:monospace;overflow-wrap:anywhere">${escape(claim.token)}</p><p>Open Munasaba, log in or create an account, then go to <strong>Profile &rarr; Direct venue bookings</strong>. Paste this code and tap <strong>Link my booking</strong> to view your booking, payments and refund updates.</p><p>This code can be used once and expires on ${escape(new Date(claim.expiresAt).toUTCString())}. Keep it private. If it expires, ask your organiser for a new code.</p>`,
    idempotencyKey: `manual-booking-code/${notice._id}`,
  });
  if (!result?.id) throw new Error("Booking code email was not accepted by the email provider");
  return true;
}
module.exports = { queueBookingCode, deliverBookingCode };