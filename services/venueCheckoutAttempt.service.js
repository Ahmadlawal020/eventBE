const { randomUUID } = require("crypto");
const Booking = require("../models/client/eventCenterBooking.schema");
const { fail } = require("./venueAccess.service");
const missingTransaction = error => [400, 404].includes(error.response?.status) && /^transaction (?:not found|reference not found)[.!]?$/i.test(error.response?.data?.message || "");
function response(booking, pending = false) {
  return { success: true, message: pending ? "Your payment is being checked. Do not pay again. Retry verification or check payment history." : "Payment initialized successfully", data: {
    reference: booking.paymentReference, reservationExpiresAt: booking.reservationExpiresAt,
    checkoutPending: pending, ...(pending ? {} : { access_code: booking.checkoutAccessCode, authorization_url: booking.checkoutUrl }),
    pricing: { subtotalAmount: booking.subtotalPrice?.amount, totalAmount: booking.totalPrice.amount,
      platformFeeAmount: booking.platformFeeAmount, buyerFeeAmount: booking.buyerFeeAmount,
      organiserFeeAmount: booking.organiserFeeAmount, organiserPayoutAmount: booking.organiserPayoutAmount,
      percentage: booking.feePercentage, mode: booking.feeMode },
  } };
}
async function resumeVenueCheckout(id, gateway) {
  let booking = await Booking.findById(id).select("+checkoutAccessCode +checkoutUrl +checkoutSubaccount");
  if (!booking) throw fail(404, "Booking not found.");
  if (booking.paymentStatus !== "PENDING" || booking.status !== "ACTIVE" || booking.paymentResolutionRequired || new Date(booking.reservationExpiresAt || 0) <= new Date()) return response(booking, true);
  if (booking.checkoutAccessCode) return response(booking);
  const token = randomUUID();
  const claimed = await Booking.findOneAndUpdate({ _id: id, paymentStatus: "PENDING", status: "ACTIVE", reservationExpiresAt: { $gt: new Date() },
    $or: [{ checkoutLockedUntil: null }, { checkoutLockedUntil: { $lte: new Date() } }] },
    { $set: { checkoutToken: token, checkoutLockedUntil: new Date(Date.now() + 90000) } }, { new: true }).select("+checkoutAccessCode +checkoutUrl +checkoutSubaccount");
  if (!claimed) return response(booking, true);
  booking = claimed;
  try {
    if (booking.checkoutAccessCode) return response(booking);
    // A retry must reconcile the original reference before attempting initialization.
    // Never change a reference, price or payout destination after an uncertain response.
    if (booking.checkoutAttemptedAt || !booking.checkoutSnapshotVersion) {
      try { await gateway.verifyPayment(booking.paymentReference); return response(booking, true); }
      catch (error) { if (!missingTransaction(error)) return response(booking, true); }
    }
    // Older attempts lack an immutable split destination and cannot safely be initialized again.
    if (!booking.checkoutSnapshotVersion) return response(booking, true);
    await Booking.updateOne({ _id: id, checkoutToken: token }, { $set: { checkoutAttemptedAt: new Date() } });
    const payment = await gateway.initializePayment({ email: booking.guestDetails.email, amount: booking.totalPrice.amount,
      currency: booking.totalPrice.currency, reference: booking.paymentReference,
      subaccount: booking.bookingMode === "REVIEW" ? undefined : booking.checkoutSubaccount,
      transactionCharge: booking.bookingMode === "REVIEW" ? undefined : Math.round(booking.platformFeeAmount * 100),
      metadata: { type: "EVENT_CENTER", eventCenterId: String(booking.eventCenter), organiserId: String(booking.organiser),
        buyerId: String(booking.buyer), bookingMode: booking.bookingMode },
    });
    if (!payment.access_code || !payment.authorization_url) return response(booking, true);
    const saved = await Booking.findOneAndUpdate({ _id: id, checkoutToken: token, status: "ACTIVE", paymentStatus: "PENDING", reservationExpiresAt: { $gt: new Date() } },
      { $set: { checkoutAccessCode: payment.access_code, checkoutUrl: payment.authorization_url } }, { new: true }).select("+checkoutAccessCode +checkoutUrl");
    return saved ? response(saved) : response(booking, true);
  } catch (error) {
    // Preserve the reference even if the gateway or persistence response was lost.
    return response(booking, true);
  } finally {
    await Booking.updateOne({ _id: id, checkoutToken: token }, { $unset: { checkoutToken: 1, checkoutLockedUntil: 1 } });
  }
}
module.exports = { resumeVenueCheckout };
