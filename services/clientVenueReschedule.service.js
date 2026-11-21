const mongoose = require("mongoose"), { randomUUID, createHash } = require("crypto");
const Booking = require("../models/client/eventCenterBooking.schema"), Venue = require("../models/client/eventCenter.schema");
const Attempt = require("../models/client/venueRescheduleCheckout.schema"), Operations = require("../models/client/bookingOperations.schema");
const { fail } = require("./venueAccess.service"), finance = require("./venueRescheduleFinance.service");
const { getRecord } = require("./bookingOperations.service");
const minor = value => Math.round(Number(value) * 100);
async function prepare(id, dates, actor, session = null) {
 const booking = await Booking.findOne({ _id: id, buyer: actor }).session(session);
 if (!booking) throw fail(404, "Booking not found.");
 if (booking.rescheduleCheckoutId) throw fail(409, "Finish or check your existing reschedule payment before choosing other dates.");
 const terms = require("./venueReschedulePolicy.service").rescheduleTerms(booking);
 if (!terms.canRequest) throw fail(409, terms.reason);
 const venue = await Venue.findById(booking.eventCenter).session(session);
 const { quote } = await require("./venueLifecycle.service").quoteReschedule(booking, venue, dates, { allowPriceChange: true });
 const record = await getRecord(venue._id, booking, session);
 const base = finance.review(booking, venue, quote, record);
 const approvalRequired = booking.cancellationPolicy?.rescheduleApprovalRequired !== false;
 const increase = Math.max(0, base.newPriceMinor - base.paidMinor);
 const fees = await require("./ticketFees.service").getPlatformFees();
 const pricing = require("./ticketFees.service").calculateEventCenterPricing({ subtotalAmount: increase / 100, currency: quote.currency, fees, feeCollectionMode: "PASS_TO_BUYER" });
 const additionalFeeMinor = approvalRequired ? 0 : minor(pricing.buyerFeeAmount);
 const finalNewPriceMinor = base.newPriceMinor + additionalFeeMinor;
 const review = { ...base, approvalRequired, additionalFeeMinor,
   newPriceMinor: finalNewPriceMinor,
   priceDifferenceMinor: finalNewPriceMinor - base.previousPriceMinor,
   balanceMinor: Math.max(0, finalNewPriceMinor - base.paidMinor),
   refundMinor: Math.max(0, base.paidMinor - finalNewPriceMinor),
   payNowMinor: approvalRequired ? 0 : Math.max(0, finalNewPriceMinor - base.paidMinor) };
 if (![review.newPriceMinor, review.payNowMinor, additionalFeeMinor].every(Number.isSafeInteger)) throw fail(400, "Invalid reschedule amount.");
 review.reviewToken = createHash("sha256").update(JSON.stringify(review)).digest("hex");
 return { booking, venue, record, quote, review };
}
async function apply(booking, venue, record, review, actor, reason, session, attempt = null) {
 const previousDates = booking.selectedDates.map(d => d.toObject ? d.toObject() : d);
 await finance.saveAgreement(booking, review, actor, session);
 const changes = { $inc: { rescheduleBuyerFeesMinor: review.additionalFeeMinor || 0 } };
 if (attempt) changes.$push = { payments: { id: attempt.paymentReference, kind: "PAYMENT", method: "PAYSTACK", amountMinor: minor(attempt.totalPrice.amount), platformFeeMinor: review.additionalFeeMinor, reference: attempt.paymentReference, at: new Date(), actor } };
 await Operations.updateOne({ _id: `${venue._id}:${booking._id}` }, changes, { session });
 booking.selectedDates = review.dates;
 booking.rescheduledPrice = { amount: review.newPriceMinor / 100, currency: review.currency };
 booking.rescheduleCount = (booking.rescheduleCount || 0) + 1;
 booking.rescheduleCheckoutId = null;
 for (const field of ["unavailableDates", "unavailableSlots"]) venue.availability[field] = (venue.availability[field] || []).filter(r => String(r.bookingId) !== String(booking._id) && (!attempt || String(r.bookingId) !== `reschedule-${attempt._id}`));
 const field = booking.bookingUnit === "hour" ? "unavailableSlots" : "unavailableDates";
 venue.availability[field].push(...review.dates.map(d => ({ ...d, type: "BOOKED", bookingId: String(booking._id), clientName: booking.guestDetails?.fullName })));
 await venue.save({ session }); await booking.save({ session });
 await require("./venueBookingEvents.service").recordVenueEvent(booking, "RESCHEDULED", actor, session, {
  previousDates, previousPrice: { amount: review.previousPriceMinor / 100, currency: review.currency }, totalPrice: booking.rescheduledPrice,
  priceDifferenceMinor: review.newPriceMinor - review.previousPriceMinor, balanceMinor: 0, refundMinor: review.refundMinor,
  reason: reason || "Client rescheduled automatically; any lower-price refund is paid directly by the organiser.",
 });
 return { completed: true, review };
}
async function submit(id, dates, actor, { reviewToken, reason }) {
 if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw fail(400, "Enter a reason of up to 500 characters.");
 // Lost responses resume the same attempt; never initialize a second top-up.
 const current = await Booking.findOne({ _id: id, buyer: actor }).lean();
 if (!current) throw fail(404, "Booking not found.");
 if (current.rescheduleCheckoutId) return resume(current.rescheduleCheckoutId, actor);
 const result = await mongoose.connection.transaction(async session => {
  const { booking, venue, record, review } = await prepare(id, dates, actor, session);
  finance.assertReview(review, reviewToken);
  if (review.approvalRequired) {
   booking.rescheduleRequest = { id: randomUUID(), status: "PENDING", dates: review.dates, reason: reason.trim(), requestedAt: new Date() };
   await Venue.updateOne({ _id: venue._id }, { $inc: { bookingVersion: 1 } }, { session });
   await booking.save({ session });
   const hostRecipients = [...new Set([booking.organiser, ...(venue.coOrganisers || [])].filter(Boolean).map(String))]
     .filter(r => r !== String(actor));
   await require("./eventCenterRefundNotifications.service").queueNotices(
     hostRecipients.map(recipient => ({
       key: `reschedule-request:${booking.rescheduleRequest.id}:${recipient}`,
       recipient,
       sender: actor,
       type: "SYSTEM",
       title: "Date change requested",
       message: "Review the requested dates and price. Any balance or refund is settled directly with the customer after approval.",
       data: { screen: "VenueBookingOperations", bookingId: String(id), venueId: String(venue._id) },
     })),
     session,
   );
   return { requested: true, review };
  }
  if (review.payNowMinor === 0) return apply(booking, venue, record, review, actor, reason, session);
  const owner = await require("../models/client/user.schema").findById(booking.organiser).select("vendorAccountCode").session(session);
  if (!owner?.vendorAccountCode) throw fail(409, "The organiser must connect a payout account before accepting this reschedule payment.");
  const first = require("./bookingAttendance.service").bookingSessions(booking)[0];
  const targetFirst = require("./bookingAttendance.service").bookingSessions({ selectedDates: review.dates, bookingUnit: booking.bookingUnit })[0];
  const expiry = new Date(Math.min(Date.now() + 30 * 60000, +new Date(first.startsAt), +new Date(booking.bookingUnit === "hour" ? targetFirst.startsAt : targetFirst.endsAt)));
  if (expiry <= new Date()) throw fail(409, "There is no longer enough time to complete this reschedule.");
  const [attempt] = await Attempt.create([{ booking: id, buyer: actor, organiser: booking.organiser, eventCenter: venue._id,
   paymentReference: `MNS-RS-${randomUUID()}`, totalPrice: { amount: review.payNowMinor / 100, currency: review.currency },
   platformFeeAmount: review.additionalFeeMinor / 100, checkoutSubaccount: owner.vendorAccountCode,
   guestDetails: { email: booking.guestDetails?.email }, reservationExpiresAt: expiry,
   review, reason, originalCount: booking.rescheduleCount || 0, ledgerRevision: record.revision,
  }], { session });
  booking.rescheduleCheckoutId = attempt._id;
  const field = booking.bookingUnit === "hour" ? "unavailableSlots" : "unavailableDates";
  venue.availability[field].push(...review.dates.map(d => ({ ...d, type: "BOOKED", bookingId: `reschedule-${attempt._id}`, pendingCheckout: true })));
  await venue.save({ session }); await booking.save({ session });
  return { attemptId: attempt._id };
 });
 return result.attemptId ? resume(result.attemptId, actor) : result;
}
async function resume(id, actor) {
 const attempt = await Attempt.findOne({ _id: id, buyer: actor }).lean();
 if (!attempt) throw fail(404, "Reschedule payment not found.");
 const payment = await require("./venueCheckoutAttempt.service").resumeVenueCheckout(id, require("./payment").getPaymentGateway(), Attempt);
 return { payment: payment.data, review: attempt.review, status: attempt.status, refundState: attempt.refund?.state };
}
async function release(attempt, session) {
 await Venue.updateOne({ _id: attempt.eventCenter }, { $pull: { "availability.unavailableDates": { bookingId: `reschedule-${attempt._id}` }, "availability.unavailableSlots": { bookingId: `reschedule-${attempt._id}` } } }, { session });
 await Booking.updateOne({ _id: attempt.booking, rescheduleCheckoutId: attempt._id }, { $set: { rescheduleCheckoutId: null } }, { session });
}
async function complete(reference, transaction, actor) {
 return mongoose.connection.transaction(async session => {
  const attempt = await Attempt.findOne({ paymentReference: reference }).session(session);
  require("./checkoutSafety.service").validatePayment(attempt, transaction, "EVENT_CENTER", actor);
  if (attempt.status === "COMPLETED" || attempt.refund?.state) return { completed: attempt.status === "COMPLETED", refundState: attempt.refund?.state, review: attempt.review };
  const booking = await Booking.findById(attempt.booking).session(session);
  const venue = await Venue.findById(attempt.eventCenter).session(session);
  const record = booking && await getRecord(attempt.eventCenter, booking, session);
  const paidAt = new Date(transaction.paid_at || Date.now());
  const paidOnTime = !attempt.reservationExpiresAt || paidAt <= new Date(attempt.reservationExpiresAt);
  let valid = attempt.status === "ACTIVE" && paidOnTime && booking && venue && !venue.archivedAt &&
   venue.status === "LISTED" && String(booking.buyer) === String(attempt.buyer) &&
   !booking.checkIn?.isCheckedIn && !booking.paymentResolutionRequired && !booking.refund?.state &&
   String(booking.rescheduleCheckoutId) === String(attempt._id) && ["ACTIVE", "CONFIRMED"].includes(booking.status) &&
   (booking.rescheduleCount || 0) === attempt.originalCount && record.revision === attempt.ledgerRevision;
  if (valid) {
   const candidate = venue.toObject();
   for (const field of ["unavailableDates", "unavailableSlots"]) candidate.availability[field] = candidate.availability[field].filter(r => String(r.bookingId) !== String(booking._id) && String(r.bookingId) !== `reschedule-${attempt._id}`);
   candidate.availability.preparationTime = 0;
   try { require("./venueBookingRules.service").assertVenueSchedule(candidate, attempt.review.dates, booking.bookingUnit, { checkTiming: false }); }
   catch (error) { if (![400, 409].includes(error.status || error.statusCode)) throw error; valid = false; }
  }
  if (!valid) {
   await release(attempt, session);
   attempt.status = "CANCELLED"; attempt.paymentStatus = "COMPLETED"; attempt.paymentResolutionRequired = true;
   attempt.refund = { state: "QUEUED", amountMinor: minor(attempt.totalPrice.amount) };
   await attempt.save({ session });
   await require("./eventCenterRefundNotifications.service").queueNotices([{ key: `reschedule-payment-return:${attempt._id}`, recipient: attempt.buyer, type: "SYSTEM", title: "Reschedule payment being returned", message: "The date change could not be completed. Your original booking remains unchanged; a full refund of this extra payment is queued with the payment provider.", data: { screen: "TicketDetails", ticketId: String(attempt.booking) } }], session);
   return { completed: false, refundState: "QUEUED" };
  }
  const result = await apply(booking, venue, record, attempt.review, attempt.buyer, attempt.reason, session, attempt);
  attempt.status = "COMPLETED"; attempt.paymentStatus = "COMPLETED"; await attempt.save({ session });
  return result;
 });
}
async function verify(reference, actor) {
 const attempt = await Attempt.findOne({ paymentReference: reference, buyer: actor }).lean();
 if (!attempt) throw fail(404, "Reschedule payment not found.");
 if (attempt.status === "COMPLETED" || attempt.refund?.state) return { completed: attempt.status === "COMPLETED", refundState: attempt.refund?.state };
 const transaction = await require("./payment").getPaymentGateway().verifyPayment(reference);
 if (transaction.status === "success") return complete(reference, transaction, actor);
 return { completed: false, pending: attempt.status === "ACTIVE", status: attempt.status };
}
async function state(id, actor) {
 const booking = await Booking.findOne({ _id: id, buyer: actor }).lean();
 if (!booking) throw fail(404, "Booking not found.");
 const attempt = await Attempt.findOne({ booking: id, buyer: actor }).sort({ createdAt: -1 }).lean();
 const outstandingReturns = await Attempt.find({ booking: id, buyer: actor, "refund.state": { $in: ["QUEUED", "SUBMITTING", "PENDING", "NEEDS_ATTENTION"] }, ...(attempt ? { _id: { $ne: attempt._id } } : {}) }).select("paymentReference refund.state totalPrice").lean();
 return { outstandingReturns: outstandingReturns.map(row => ({ reference: row.paymentReference, refundState: row.refund.state, amount: row.totalPrice.amount, currency: row.totalPrice.currency })), revision: `${booking.rescheduleCount || 0}:${attempt?._id || ""}:${attempt?.status || ""}:${attempt?.refund?.state || ""}`, approvalRequired: booking.cancellationPolicy?.rescheduleApprovalRequired !== false,
  payment: attempt && (attempt.status === "ACTIVE" || attempt.refund?.state) ? { reference: attempt.paymentReference, status: attempt.status, refundState: attempt.refund?.state, expiresAt: attempt.reservationExpiresAt } : null };
}
async function reconcile() {
 const due = await Attempt.find({ $or: [{ status: "ACTIVE" }, { status: "CANCELLED", paymentStatus: "FAILED", createdAt: { $gte: new Date(Date.now() - 7 * 86400000) } }], nextCheckAt: { $not: { $gt: new Date() } } }).sort({ nextCheckAt: 1, createdAt: 1 }).limit(100).lean();
 let deferred = 0, failed = 0;
 for (const attempt of due) {
  try {
   let transaction;
   try { transaction = await require("./payment").getPaymentGateway().verifyPayment(attempt.paymentReference); }
   catch (error) { if (![400, 404].includes(error.response?.status) || !/^transaction (?:not found|reference not found)[.!]?$/i.test(error.response?.data?.message || "")) throw error; transaction = { status: "missing" }; }
   if (transaction.status === "success") await complete(attempt.paymentReference, transaction);
   else if (["missing", "failed", "abandoned", "pending", "ongoing"].includes(transaction.status) && attempt.reservationExpiresAt <= new Date()) await mongoose.connection.transaction(async session => {
    const current = await Attempt.findOne({ _id: attempt._id, status: "ACTIVE" }).session(session);
    if (!current) return;
    await release(current, session); current.status = "CANCELLED"; current.paymentStatus = "FAILED"; await current.save({ session });
   });
  } catch { deferred++; }
  await Attempt.updateOne({ _id: attempt._id }, { $set: { nextCheckAt: new Date(Date.now() + 60000) } });
 }
 const refunds = await Attempt.find({ "refund.state": { $in: ["QUEUED", "SUBMITTING", "PENDING", "NEEDS_ATTENTION"] }, $or: [{ "refund.leaseUntil": null }, { "refund.leaseUntil": { $lte: new Date() } }] }).limit(100).lean();
 for (const attempt of refunds) { try { await require("./venueRefund.service").processVenueRefund(attempt._id, Attempt); } catch { failed++; } }
 failed += await Attempt.countDocuments({ "refund.state": "NEEDS_ATTENTION" });
 return { processed: due.length, deferred, failed };
}
module.exports = { prepare, submit, complete, resume, verify, state, reconcile };
