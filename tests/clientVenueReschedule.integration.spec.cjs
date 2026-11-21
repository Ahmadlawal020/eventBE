process.env.NODE_ENV = 'test'; process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false'; process.env.QR_SIGNING_SECRET = 'client-reschedule-test-only';
const { test, mock } = require('node:test'), assert = require('node:assert/strict');
const mongoose = require('mongoose'), { MongoMemoryReplSet } = require('mongodb-memory-server');
const Booking = require('../models/client/eventCenterBooking.schema'), Venue = require('../models/client/eventCenter.schema');
const Operations = require('../models/client/bookingOperations.schema'), Attempt = require('../models/client/venueRescheduleCheckout.schema');
const History = require('../models/client/bookingHistory.schema'), User = require('../models/client/user.schema');
const service = require('../services/clientVenueReschedule.service');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0,10);
test('client rescheduling quotes, collects and applies exactly one price adjustment', { timeout: 120000 }, async t => {
 let db; let initializations = 0, refundCalls = 0;
 const gateway = { initializePayment: async payload => { initializations++; return { reference: payload.reference, access_code: 'access-test', authorization_url: 'https://checkout.example.test' }; }, verifyPayment: async () => ({ status: 'pending' }), refundPayment: async () => { refundCalls++; return { id: 'provider-refund', status: 'processed', currency: 'NGN', amount: 5500 }; } };
 mock.method(require('../services/payment'), 'getPaymentGateway', () => gateway);
 mock.method(require('../services/ticketFees.service'), 'getPlatformFees', async () => ({ eventCenterCommission: 10 }));
 try {
 db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri(), { dbName: 'isolated_client_reschedule' });
 await Promise.all([Venue, Booking, Operations, Attempt, History].map(model => model.init()));
 async function fixture({ approval = false, price = 150, unit = 'day' } = {}) {
  const owner = new mongoose.Types.ObjectId(), buyer = new mongoose.Types.ObjectId(), venueId = new mongoose.Types.ObjectId(), id = new mongoose.Types.ObjectId();
  const dates = [{ date: day(20), ...(unit === 'hour' ? { startTime: '10:00', endTime: '12:00' } : {}) }];
  const target = [{ date: day(21), ...(unit === 'hour' ? { startTime: '10:00', endTime: '12:00' } : {}) }];
  await User.collection.insertOne({ _id: owner, email: `${owner}@example.test`, vendorAccountCode: 'ACCT-test' });
  await Venue.collection.insertOne({ _id: venueId, createdBy: owner, venueName: 'Test venue', status: 'LISTED', updatedAt: new Date(), basePrice: { amount: unit === 'hour' ? price / 2 : price, currency: 'NGN', unit }, availability: { minDuration: 1, maxDuration: 10, unavailableDates: unit === 'day' ? dates.map(d => ({ ...d, type: 'BOOKED', bookingId: String(id) })) : [], unavailableSlots: unit === 'hour' ? dates.map(d => ({ ...d, type: 'BOOKED', bookingId: String(id) })) : [] } });
  await Booking.create({ _id: id, buyer, organiser: owner, eventCenter: venueId, guestDetails: { email: 'client@example.test', fullName: 'Client' }, selectedDates: dates, bookingUnit: unit, duration: unit === 'hour' ? 2 : 1, totalPrice: { amount: 110, currency: 'NGN' }, subtotalPrice: { amount: 100, currency: 'NGN' }, platformFeeAmount: 10, status: 'CONFIRMED', paymentStatus: 'COMPLETED', cancellationPolicy: { rescheduleApprovalRequired: approval, allowGuestReschedule: true, maxReschedules: 5 } });
  return { id, buyer, owner, venueId, dates, target };
 }
 const start = async f => { const { review } = await service.prepare(f.id, f.target, f.buyer); const result = await service.submit(f.id, f.target, f.buyer, { reviewToken: review.reviewToken, reason: 'New date' }); return { review, result }; };
 for (const unit of ['day', 'hour']) await t.test(`${unit}: higher price collects increase plus fee, moves once, and preserves original charge`, async () => {
  const f = await fixture({ unit }); const before = initializations; const { review, result } = await start(f);
  assert.equal(review.additionalFeeMinor, 500); assert.equal(review.payNowMinor, 5500); assert.equal(review.newPriceMinor, 16500);
  assert.equal(initializations, before + 1); assert.ok(result.payment.access_code);
  const original = await Booking.findById(f.id); assert.equal(original.selectedDates[0].date.toISOString().slice(0,10), day(20));
  await service.submit(f.id, f.target, f.buyer, { reason: 'Retry', reviewToken: review.reviewToken }); assert.equal(initializations, before + 1);
  await assert.rejects(service.prepare(f.id, f.target, f.buyer), /existing reschedule payment/);
  const transaction = { reference: result.payment.reference, status: 'success', amount: 5500, currency: 'NGN' };
  await assert.rejects(service.complete(transaction.reference, { ...transaction, amount: 1 }, f.buyer), /amount/);
  await assert.rejects(service.complete(transaction.reference, transaction, new mongoose.Types.ObjectId()), /another user/);
  await Promise.all([service.complete(transaction.reference, transaction, f.buyer), service.complete(transaction.reference, transaction, f.buyer)]);
  const saved = await Booking.findById(f.id).lean(), ledger = await Operations.findById(`${f.venueId}:${f.id}`).lean();
  assert.equal(saved.totalPrice.amount, 110); assert.equal(saved.rescheduledPrice.amount, 165); assert.equal(saved.rescheduleCount, 1);
  assert.equal(ledger.payments.length, 1); assert.equal(ledger.rescheduleBuyerFeesMinor, 500);
  assert.equal(require('../services/bookingOperations.service').paymentSummary(saved, ledger).balanceMinor, 0);
  assert.equal(await require('../services/venueCancellation.service').adjustedRefund(saved), 15000);
  assert.equal(await History.countDocuments({ bookingId: String(f.id), action: 'RESCHEDULED' }), 1);
  assert.equal((await Attempt.findOne({ booking: f.id })).status, 'COMPLETED');
 });
 await t.test('approval-required price increase creates a request without Paystack or changing dates', async () => {
  const f = await fixture({ approval: true }); const before = initializations; const { review, result } = await start(f);
  assert.equal(review.payNowMinor, 0); assert.equal(review.balanceMinor, 5000); assert.equal(result.requested, true); assert.equal(initializations, before);
  const saved = await Booking.findById(f.id); assert.equal(saved.rescheduleRequest.status, 'PENDING'); assert.equal(saved.selectedDates[0].date.toISOString().slice(0,10), day(20));
 });
 await t.test('lower price moves immediately and customer may supply bank details before refund approval', async () => {
  const f = await fixture({ price: 60 }); const { review, result } = await start(f);
  assert.equal(review.refundMinor, 4000); assert.equal(review.payNowMinor, 0); assert.equal(result.completed, true);
  const refund = require('../services/manualRefundSettlement.service'); const context = await refund.access(String(f.venueId), String(f.id), f.buyer);
  assert.equal(refund.publicDetails(context).summary.refundDueMinor, 4000); assert.equal(context.customer, true);
  await refund.update(String(f.venueId), String(f.id), f.buyer, { action: 'BANK_DETAILS', expectedRevision: context.record.revision, accountName: 'Client Name', accountNumber: '0123456789', bankCode: '058' });
  assert.equal((await Operations.findById(`${f.venueId}:${f.id}`)).refundAccount.accountNumber, '0123456789');
 });
 await t.test('same-price change has no payment and stale quotes or other customers cannot move dates', async () => {
  const f = await fixture({ price: 100 }); const { review } = await service.prepare(f.id, f.target, f.buyer);
  await assert.rejects(service.submit(f.id, f.target, f.buyer, { reviewToken: 'stale', reason: 'Test' }), /Review|review/);
  await assert.rejects(service.prepare(f.id, f.target, new mongoose.Types.ObjectId()), e => e.status === 404);
  assert.equal((await service.submit(f.id, f.target, f.buyer, { reviewToken: review.reviewToken, reason: 'Test' })).completed, true);
 });
 await t.test('expired extra payment returns through provider once and leaves original dates intact', async () => {
  const f = await fixture(); const { result } = await start(f);
  await Attempt.updateOne({ booking: f.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1) } });
  const outcome = await service.complete(result.payment.reference, { reference: result.payment.reference, status: 'success', amount: 5500, currency: 'NGN' }, f.buyer);
  assert.equal(outcome.refundState, 'QUEUED'); const a = await Attempt.findOne({ booking: f.id });
  const before = refundCalls; await require('../services/venueRefund.service').processVenueRefund(a._id, Attempt); await require('../services/venueRefund.service').processVenueRefund(a._id, Attempt);
  assert.equal(refundCalls, before + 1); assert.equal((await Attempt.findById(a._id)).refund.state, 'PROCESSED');
  const saved = await Booking.findById(f.id); assert.equal(saved.selectedDates[0].date.toISOString().slice(0,10), day(20)); assert.equal(saved.rescheduleCheckoutId, null);
 });
 await t.test('worker keeps uncertain payments reserved and refunds late success after expiry without a webhook', async () => {
  const f = await fixture(); const { result } = await start(f);
  await Attempt.updateOne({ booking: f.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1) } });
  const originalVerify = gateway.verifyPayment;
  try {
   gateway.verifyPayment = async () => { throw new Error('Temporary provider outage'); };
   await service.reconcile(); assert.ok((await Booking.findById(f.id)).rescheduleCheckoutId);
   await Attempt.updateOne({ booking: f.id }, { $set: { nextCheckAt: new Date(0) } });
   gateway.verifyPayment = async () => ({ status: 'pending' });
   await service.reconcile(); assert.equal((await Booking.findById(f.id)).rescheduleCheckoutId, null);
   assert.equal((await Attempt.findOne({ booking: f.id })).status, 'CANCELLED');
   await Attempt.updateOne({ booking: f.id }, { $set: { nextCheckAt: new Date(0) } });
   gateway.verifyPayment = async reference => ({ reference, status: 'success', amount: 5500, currency: 'NGN' });
   const before = refundCalls; await service.reconcile();
   assert.equal(refundCalls, before + 1);
   assert.equal((await Attempt.findOne({ booking: f.id })).refund.state, 'PROCESSED');
   assert.equal((await Booking.findById(f.id)).selectedDates[0].date.toISOString().slice(0,10), day(20));
  } finally { gateway.verifyPayment = originalVerify; }
 });
 await t.test('repeated automatic increases preserve accumulated fees and organiser moves use the same ledger', async () => {
  const f = await fixture(); const first = await start(f);
  const pay = result => service.complete(result.payment.reference, { reference: result.payment.reference, status: 'success', amount: Math.round(result.review.payNowMinor), currency: 'NGN' }, f.buyer);
  await pay(first.result);
  await Venue.updateOne({ _id: f.venueId }, { $set: { 'basePrice.amount': 200 } });
  f.target = [{ date: day(22) }]; const second = await start(f);
  assert.equal(second.review.additionalFeeMinor, 500); assert.equal(second.review.newPriceMinor, 22000);
  assert.equal(second.review.payNowMinor, 5500);
  const pendingRecord = await Operations.findById(`${f.venueId}:${f.id}`);
  await assert.rejects(require('../services/manualRefundSettlement.service').update(String(f.venueId), String(f.id), f.buyer, {
   action: 'BANK_DETAILS', expectedRevision: pendingRecord.revision, accountName: 'Client Name', accountNumber: '0123456789', bankCode: '058',
  }), /pending reschedule payment/);
  assert.equal((await Operations.findById(pendingRecord._id)).revision, pendingRecord.revision);
  await pay(second.result);
  let booking = await Booking.findById(f.id), record = await Operations.findById(`${f.venueId}:${f.id}`);
  assert.equal(record.rescheduleBuyerFeesMinor, 1000);
  assert.equal(require('../services/bookingOperations.service').paymentSummary(booking, record).balanceMinor, 0);
  assert.equal(await require('../services/venueCancellation.service').adjustedRefund(booking), 20000);
  await Venue.updateOne({ _id: f.venueId }, { $set: { 'basePrice.amount': 150 } });
  const organiser = require('../services/organiserReschedule.service'), dates = [{ date: day(23) }];
  const prepared = await organiser.prepare(String(f.id), String(f.venueId), dates, f.owner);
  assert.equal(prepared.review.newPriceMinor, 17000); assert.equal(prepared.review.refundMinor, 5000);
  await organiser.commit(String(f.id), String(f.venueId), dates, f.owner, { reviewToken: prepared.review.reviewToken });
  booking = await Booking.findById(f.id); record = await Operations.findById(`${f.venueId}:${f.id}`);
  assert.equal(require('../services/bookingOperations.service').paymentSummary(booking, record).refundDueMinor, 5000);
  assert.equal(booking.totalPrice.amount, 110);
 });
 await t.test('an older unresolved provider return remains visible alongside a newer payment attempt', async () => {
  const f = await fixture(); const { result } = await start(f);
  await Attempt.updateOne({ booking: f.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1) } });
  await service.complete(result.payment.reference, { reference: result.payment.reference, status: 'success', amount: 5500, currency: 'NGN' }, f.buyer);
  f.target = [{ date: day(22) }]; const next = await start(f);
  const state = await service.state(f.id, f.buyer);
  assert.equal(state.payment.reference, next.result.payment.reference);
  assert.equal(state.outstandingReturns.length, 1);
  assert.equal(state.outstandingReturns[0].reference, result.payment.reference);
  assert.equal(state.outstandingReturns[0].amount, 55);
  await assert.rejects(service.state(f.id, new mongoose.Types.ObjectId()), error => error.status === 404);
 });
 await t.test('pending top-up blocks organiser rescheduling, collection and cancellation', async () => {
  const f = await fixture(); await start(f); const b = await Booking.findById(f.id).lean();
  await assert.rejects(require('../services/organiserReschedule.service').prepare(String(f.id), String(f.venueId), f.target, f.owner), /pending reschedule payment/);
  await assert.rejects(require('../services/venueCancellation.service').adjustedRefund(b), /pending reschedule payment/);
  await assert.rejects(require('../services/bookingOperations.service').saveOperation(f.venueId, b, { action: 'PAYMENT', expectedRevision: 0 }, f.owner), /pending reschedule payment/);
 });
 } finally { mock.restoreAll(); await mongoose.disconnect(); if (db) await db.stop(); }
});
