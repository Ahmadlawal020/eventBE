const crypto = require("crypto");
const Booking = require("../models/client/eventBooking.schema");
const Tickets = require("../models/client/userEventTicket.schema");
const fail = (message, statusCode = 409, extra = {}) => Object.assign(Error(message), { statusCode, ...extra });
function identity(body) {
  if (typeof body.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.idempotencyKey))
    throw fail("Refresh the app and start checkout with a valid attempt ID.", 400);
  const items = (Array.isArray(body.items) ? body.items : []).map(item => ({
    product: String(item.product), quantity: item.quantity, pricePerUnit: item.pricePerUnit || 0,
  })).sort((a,b) => a.product.localeCompare(b.product));
  return { checkoutKey: body.idempotencyKey,
    checkoutFingerprint: crypto.createHash("sha256").update(JSON.stringify({ eventId: String(body.eventId), paymentMethod: body.paymentMethod, items })).digest("hex") };
}
async function findAttempt(buyer, attempt) {
  const booking = await Booking.findOne({ buyer, checkoutKey: attempt.checkoutKey });
  if (booking && booking.checkoutFingerprint !== attempt.checkoutFingerprint) throw fail("Checkout attempt does not match this order.");
  return booking;
}
async function respond(bookingId, res) {
  let booking = await Booking.findById(bookingId).select("+checkoutAccessCode +checkoutUrl +checkoutSubaccount");
  if (!booking || booking.status === "CANCELLED" || booking.paymentResolutionRequired)
    throw fail("This checkout is closed. Check payment status before starting another order.", 409, { terminal: true, paymentReference: booking?.paymentReference });
  const publicBooking = () => {
    const data = booking.toObject();
    for (const key of ["checkoutAccessCode", "checkoutUrl", "checkoutSubaccount", "initializationToken", "checkoutFingerprint"]) delete data[key];
    return data;
  };
  const result = async payment => res.json({ success: true, data: { booking: publicBooking(), pricing: booking.checkoutPricing,
    ...(payment ? { payment } : { tickets: await Tickets.find({ bookingId, owner: booking.buyer }).lean() }) } });
  if (booking.paymentStatus === "COMPLETED") return result();
  if (booking.checkoutUrl && booking.checkoutAccessCode)
    return result({ reference: booking.paymentReference, access_code: booking.checkoutAccessCode, authorization_url: booking.checkoutUrl });
  if (booking.reservationExpiresAt <= new Date())
    throw fail("This checkout is awaiting payment reconciliation. Check its payment status.", 409, { paymentReference: booking.paymentReference });
  const token = crypto.randomUUID();
  const claimed = await Booking.findOneAndUpdate({ _id: bookingId, paymentStatus: "PENDING", status: "ACTIVE",
    $or: [{ initializationLockedUntil: null }, { initializationLockedUntil: { $lte: new Date() } }] },
    { $set: { initializationToken: token, initializationLockedUntil: new Date(Date.now() + 60000) } }, { new: true });
  if (!claimed) throw fail("Checkout is being prepared. Retry this same order shortly.", 409, { paymentReference: booking.paymentReference });
  try {
    booking = await Booking.findById(bookingId).select("+checkoutAccessCode +checkoutUrl +checkoutSubaccount");
    if (booking.status !== "ACTIVE" || booking.paymentResolutionRequired) throw fail("This checkout is closed. Check payment status.", 409, { terminal: true, paymentReference: booking.paymentReference });
    if (booking.paymentStatus === "COMPLETED") return result();
    if (booking.checkoutUrl && booking.checkoutAccessCode) return result({ reference: booking.paymentReference, access_code: booking.checkoutAccessCode, authorization_url: booking.checkoutUrl });
    const gateway = require("./payment").getPaymentGateway();
    const payment = await gateway.initializePayment({ email: booking.guestDetails.email, amount: booking.totalAmount / 100,
      currency: booking.currency, reference: booking.paymentReference, subaccount: booking.checkoutSubaccount,
      transactionCharge: booking.platformFeeAmount,
      metadata: { type: "EVENT_TICKET", eventId: String(booking.eventId), buyerId: String(booking.buyer) } });
    await Booking.updateOne({ _id: bookingId, initializationToken: token },
      { $set: { checkoutAccessCode: payment.access_code, checkoutUrl: payment.authorization_url } });
    return result(payment);
  } catch (error) {
    if (error.statusCode) throw error;
    // Recover a payment completed during a lost initialization response using the original reference.
    try {
      const transaction = await require("./payment").getPaymentGateway().verifyPayment(booking.paymentReference);
      if (transaction.status === "success") {
        const completion = await require("./checkoutSafety.service").completePayment(booking.paymentReference, transaction, { buyerId: booking.buyer, kind: "EVENT_TICKET" });
        if (!completion.conflict) return await respond(bookingId, res);
      }
    } catch { /* Unknown provider state remains pending for reconciliation. */ }
    // A timed-out initialization is uncertain. Keep the same reference; never create another reservation.
    throw fail("Payment setup could not be confirmed. Retry this order or check payment status.", 502, { paymentReference: booking.paymentReference });
  } finally {
    await Booking.updateOne({ _id: bookingId, initializationToken: token }, { $set: { initializationLockedUntil: new Date(0) } });
  }
}
module.exports = { identity, findAttempt, respond };
