process.env.NODE_ENV = 'test';
process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
process.env.QR_SIGNING_SECRET = 'reschedule-tests-only';
const { test } = require('node:test'), assert = require('node:assert/strict');
const mongoose = require('mongoose'), { MongoMemoryReplSet } = require('mongodb-memory-server');
const Venue = require('../models/client/eventCenter.schema'), Booking = require('../models/client/eventCenterBooking.schema');
const Operations = require('../models/client/bookingOperations.schema'), History = require('../models/client/bookingHistory.schema');
const reschedule = require('../services/organiserReschedule.service');
const operations = require('../services/bookingOperations.service');
const finance = require('../services/venueRescheduleFinance.service');
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0,10);
test('organiser reschedules retain duration and reconcile new prices without rewriting online payments', { timeout: 120000 }, async t => {
 let db;
 try {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri(), { dbName: 'isolated_reschedule_finance' });
  await Promise.all([Venue.init(), Booking.init(), Operations.init(), History.init()]);
  async function fixture(manual = false, unit = 'day') {
   const actor = new mongoose.Types.ObjectId(), venueId = new mongoose.Types.ObjectId(), id = manual ? 'manual-' + new mongoose.Types.ObjectId() : new mongoose.Types.ObjectId();
   const dates = [{ date: day(20), ...(unit === 'hour' ? { startTime: '10:00', endTime: '12:00' } : {}) }];
   const rows = dates.map(d => ({ ...d, type: manual ? 'MANUAL' : 'BOOKED', bookingId: String(id), clientName: 'Guest', totalPrice: 100, depositAmount: 100, paymentStatus: 'paid' }));
   await Venue.collection.insertOne({ _id: venueId, createdBy: actor, status: 'LISTED', updatedAt: new Date(), basePrice: { amount: 150, currency: 'NGN', unit }, availability: { minDuration: 1, maxDuration: 10, unavailableDates: unit === 'day' ? rows : [], unavailableSlots: unit === 'hour' ? rows : [] } });
   if (!manual) await Booking.create({ _id: id, buyer: new mongoose.Types.ObjectId(), organiser: actor, eventCenter: venueId, selectedDates: dates, bookingUnit: unit, duration: unit === 'hour' ? 2 : 1, subtotalPrice: { amount: 100, currency: 'NGN' }, totalPrice: { amount: 110, currency: 'NGN' }, paymentStatus: 'COMPLETED', status: 'CONFIRMED' });
   return { actor, venueId, id: String(id), dates, target: [{ date: day(21), ...(unit === 'hour' ? { startTime: '12:00', endTime: '14:00' } : {}) }] };
  }
  for (const manual of [false, true]) for (const unit of ['day', 'hour']) await t.test(`${manual ? 'manual' : 'platform'} ${unit}: duration, confirmation, history, balance, repeated confirmation`, async () => {
   const f = await fixture(manual, unit);
   const bad = unit === 'day' ? [...f.target, { date: day(22) }] : [{ date: day(21), startTime: '12:00', endTime: '15:00' }];
   await assert.rejects(reschedule.prepare(f.id, f.venueId, bad, f.actor), /duration|days or hours/);
   await assert.rejects(reschedule.prepare(f.id, f.venueId, f.dates, f.actor), /different dates/);
   const prepared = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   assert.ok(prepared.review.balanceMinor > 0);
   await assert.rejects(reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: 'stale' }), /Review|review/);
   await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: prepared.review.reviewToken });
   const history = await History.findOne({ bookingId: f.id, action: 'RESCHEDULED' });
   assert.equal(history.previousPrice.amount, manual ? 100 : 110);
   assert.equal(history.totalPrice.amount, prepared.review.newPriceMinor / 100);
   assert.equal(history.previousDates[0].date.toISOString().slice(0,10), day(20));
   const record = await Operations.findById(`${f.venueId}:${f.id}`).lean();
   const booking = await require('../services/bookingAttendance.service').loadBooking(f.venueId, f.id);
   assert.equal(operations.paymentSummary(booking, record).paidMinor, manual ? 10000 : 11000);
   assert.equal(operations.paymentSummary(booking, record).balanceMinor, prepared.review.balanceMinor);
   if (!manual) assert.equal((await Booking.findById(f.id)).totalPrice.amount, 110);
   await assert.rejects(reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: prepared.review.reviewToken }));
   assert.equal(await History.countDocuments({ bookingId: f.id, action: 'RESCHEDULED' }), 1);
  });
  for (const manual of [false, true]) await t.test(`${manual ? 'manual' : 'platform'} availability exceptions require reviewed confirmation and are recorded`, async () => {
   const f = await fixture(manual);
   await Venue.updateOne({ _id: f.venueId }, { $set: { 'availability.advanceNotice.days': 30 } });
   const { review } = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   assert.ok(review.warnings.some(w => w.code === 'ADVANCE_NOTICE'));
   await assert.rejects(reschedule.commit(f.id, f.venueId, f.target, f.actor, {}));
   await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: review.reviewToken });
   assert.ok((await History.findOne({ bookingId: f.id, action: 'RESCHEDULED' })).scheduleWarnings.some(w => w.code === 'ADVANCE_NOTICE'));
  });
  await t.test('manual creation requires acceptance, rejects changed tokens and records exceptions', async () => {
   const f = await fixture(true);
   await Venue.updateOne({ _id: f.venueId }, { $set: { 'availability.preparationTime': 2 } });
   const v = await Venue.findById(f.venueId).lean();
   const row = { date: day(21), type: 'MANUAL', bookingId: 'manual-warning-test', clientName: 'Test', totalPrice: 100, depositAmount: 30, paymentStatus: 'partially_paid' };
   const patch = { availability: { ...v.availability, unavailableDates: [...v.availability.unavailableDates, row] } };
   const commit = require('../services/venueCalendarMutation.service').commitVenueUpdate;
   let token;
   await assert.rejects(commit(v._id, patch, v.updatedAt, f.actor), e => { token = e.reviewToken; return e.code === 'SCHEDULE_REVIEW_REQUIRED' && e.warnings.some(w => w.code === 'PREPARATION_TIME'); });
   assert.equal(await History.countDocuments({ bookingId: row.bookingId }), 0);
   await assert.rejects(commit(v._id, patch, v.updatedAt, f.actor, { scheduleOverrideToken: 'wrong' }));
   await commit(v._id, patch, v.updatedAt, f.actor, { scheduleOverrideToken: token });
   assert.ok((await History.findOne({ bookingId: row.bookingId })).scheduleWarnings.some(w => w.code === 'PREPARATION_TIME'));
  });
  await t.test('reschedule follow-up list is venue scoped, finance protected and uses actual balances', async () => {
   const f = await fixture(true);
   const { review } = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: review.reviewToken });
   const list = require('../services/rescheduleBalances.service').list;
   const result = await list(f.venueId, f.actor);
   assert.equal(result.items.length, 1);
   assert.equal(result.items[0].bookingId, f.id);
   assert.equal(result.items[0].summary.balanceMinor, review.balanceMinor);
   await assert.rejects(list(f.venueId, new mongoose.Types.ObjectId()), e => e.status === 403);
   await assert.rejects(reschedule.prepare(f.id, f.venueId, f.dates, new mongoose.Types.ObjectId()), e => e.status === 403);
   const other = await fixture(true);
   assert.equal((await list(other.venueId, other.actor)).items.length, 0);
  });
  await t.test('platform extra collection is capped, requires reference, and increases cancellation refund', async () => {
   const f = await fixture(); const { review } = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: review.reviewToken });
   const b = await Booking.findById(f.id).lean(), record = await operations.getRecord(f.venueId, b);
   const payload = { action: 'PAYMENT', kind: 'PAYMENT', id: 'payment-test-123', method: 'BANK_TRANSFER', amount: 50, expectedRevision: record.revision };
   await assert.rejects(operations.saveOperation(f.venueId, b, payload, f.actor), /reference/);
   await assert.rejects(operations.saveOperation(f.venueId, b, { ...payload, amount: 51, reference: 'receipt-1' }, f.actor), /outstanding/);
   await operations.saveOperation(f.venueId, b, { ...payload, reference: 'receipt-1' }, f.actor);
   assert.equal(await require('../services/venueCancellation.service').adjustedRefund(b), 15000);
  });
  for (const manual of [false, true]) await t.test(`${manual ? 'manual' : 'platform'} lower price retains collected money and creates a refund balance`, async () => {
   const f = await fixture(manual); await Venue.updateOne({ _id: f.venueId }, { $set: { 'basePrice.amount': 60 } });
   const { review } = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   assert.equal(review.refundMinor, 4000);
   await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: review.reviewToken });
   const b = await require('../services/bookingAttendance.service').loadBooking(f.venueId, f.id);
   const record = await operations.getRecord(f.venueId, b);
   assert.equal(operations.paymentSummary(b, record).refundDueMinor, 4000);
   await operations.saveOperation(f.venueId, b, { action: 'REFUND_APPROVE', id: 'refund-test-123', amount: 40, reason: 'Lower price after rescheduling', expectedRevision: record.revision }, f.actor);
   if (!manual) await assert.rejects(require('../services/venueCancellation.service').adjustedRefund(b), /outstanding/);
  });
  await t.test('platform refund requires proof and customer acknowledgement, then cancellation refunds only what remains', async () => {
   const f = await fixture(); await Venue.updateOne({ _id: f.venueId }, { $set: { 'basePrice.amount': 60 } });
   const { review } = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: review.reviewToken });
   const b = await Booking.findById(f.id).lean(); let record = await operations.getRecord(f.venueId, b);
   await operations.saveOperation(f.venueId, b, { action: 'REFUND_APPROVE', id: 'refund-proof-123', amount: 40, reason: 'Lower price', expectedRevision: record.revision }, f.actor);
   record = await operations.getRecord(f.venueId, b);
   const payment = { action: 'PAYMENT', kind: 'REFUND', id: 'refund-payment-123', refundId: 'refund-proof-123', amount: 40, method: 'CASH', reason: 'Rescheduled', reference: 'receipt-123', expectedRevision: record.revision };
   await assert.rejects(operations.saveOperation(f.venueId, b, payment, f.actor), /proof/);
   // Stand in for the existing authenticated upload verifier, tested in the refund suite.
   await Operations.updateOne({ _id: record._id }, { $set: { 'refunds.0.settlement': { id: 'settlement-123', method: 'CASH' }, 'refunds.0.receipt': { publicId: 'verified-private-proof', settlementId: 'settlement-123', uploadedAt: new Date() } } });
   await operations.saveOperation(f.venueId, b, payment, f.actor);
   record = await operations.getRecord(f.venueId, b);
   await assert.rejects(operations.saveOperation(f.venueId, b, { action: 'REFUND_CONFIRM', refundId: 'refund-proof-123', expectedRevision: record.revision }, f.actor), /customer/);
   const access = await require('../services/manualRefundSettlement.service').access(f.venueId, f.id, b.buyer);
   assert.equal(access.customer, true);
   await operations.saveOperation(f.venueId, b, { action: 'REFUND_CONFIRM', refundId: 'refund-proof-123', expectedRevision: record.revision }, b.buyer);
   assert.equal(await require('../services/venueCancellation.service').adjustedRefund(b), 6000);
   await require('../services/venueCancellation.service').cancel(f.id, { actor: f.actor, expectedRefundMinor: 6000, reason: 'Customer no longer attending' });
   const refund = await require('../models/client/eventCenterRefund.schema').findOne({ bookingId: f.id });
   assert.equal(refund.amountMinor, 6000);
  });
  await t.test('a changed price invalidates confirmation and history failure rolls the entire move back', async () => {
   const f = await fixture(); const initial = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   await Venue.updateOne({ _id: f.venueId }, { $set: { 'basePrice.amount': 175 } });
   await assert.rejects(reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: initial.review.reviewToken }), /changed/);
   const current = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   const original = History.create; History.create = async () => { throw Error('history unavailable'); };
   try { await assert.rejects(reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: current.review.reviewToken }), /history unavailable/); }
   finally { History.create = original; }
   assert.equal((await Booking.findById(f.id)).selectedDates[0].date.toISOString().slice(0,10), day(20));
   assert.equal(await Operations.countDocuments({ bookingId: f.id }), 0);
  });
  await t.test('moving one manual booking preserves another paid booking and records cancellation reason', async () => {
   const f = await fixture(true);
   await Venue.updateOne({ _id: f.venueId }, { $push: { 'availability.unavailableDates': { date: day(30), bookingId: 'manual-other-123', type: 'MANUAL', clientName: 'Other guest', totalPrice: 80, paymentStatus: 'paid' } } });
   const { review } = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
   await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: review.reviewToken });
   const venue = await Venue.findById(f.venueId).lean();
   assert.equal(venue.availability.unavailableDates.find(r => r.bookingId === 'manual-other-123').totalPrice, 80);
   const candidate = { ...venue.availability, unavailableDates: venue.availability.unavailableDates.filter(r => r.bookingId !== f.id) };
   await require('../services/venueCalendarMutation.service').commitVenueUpdate(f.venueId, { availability: candidate }, venue.updatedAt, f.actor, { reason: 'Customer cancelled after date change' });
   assert.equal((await History.findOne({ bookingId: f.id, action: 'CANCELLED' })).reason, 'Customer cancelled after date change');
  });
  for (const unit of ['day', 'hour']) for (const newPrice of [150, 60, 30, 20]) {
   await t.test(`partially paid manual ${unit}: new price ${newPrice} uses actual collections of 30`, async () => {
    const f = await fixture(true, unit);
    const field = unit === 'hour' ? 'unavailableSlots' : 'unavailableDates';
    await Venue.updateOne({ _id: f.venueId }, { $set: {
      'basePrice.amount': newPrice / (unit === 'hour' ? 2 : 1),
      [`availability.${field}.0.depositAmount`]: 30,
      [`availability.${field}.0.paymentStatus`]: 'partially_paid',
    } });
    // Cover both legacy deposits and an opening deposit plus a later collection.
    if (newPrice !== 150) await Operations.create({ _id: `${f.venueId}:${f.id}`, eventCenter: f.venueId, bookingId: f.id,
      openingPaidMinor: 2000, payments: [{ id: 'later-payment-123', kind: 'PAYMENT', amountMinor: 1000, method: 'CASH' }] });
    const { review } = await reschedule.prepare(f.id, f.venueId, f.target, f.actor);
    assert.equal(review.previousPriceMinor, 10000);
    assert.equal(review.paidMinor, 3000);
    assert.equal(review.balanceMinor, Math.max(0, newPrice - 30) * 100);
    assert.equal(review.refundMinor, Math.max(0, 30 - newPrice) * 100);
    await reschedule.commit(f.id, f.venueId, f.target, f.actor, { reviewToken: review.reviewToken });
    const booking = await require('../services/bookingAttendance.service').loadBooking(f.venueId, f.id);
    const record = await operations.getRecord(f.venueId, booking);
    const summary = operations.paymentSummary(booking, record);
    assert.equal(summary.paidMinor, 3000);
    assert.equal(summary.balanceMinor, review.balanceMinor);
    assert.equal(summary.refundDueMinor, review.refundMinor);
    const venue = await Venue.findById(f.venueId).lean();
    const row = venue.availability[field].find(r => r.bookingId === f.id);
    assert.equal(row.depositAmount, 30);
    assert.equal(row.paymentStatus, newPrice > 30 ? 'partially_paid' : 'paid');
    if (newPrice > 30) {
      await operations.saveOperation(f.venueId, booking, { action: 'PAYMENT', kind: 'PAYMENT', id: 'after-reschedule-123', amount: 10,
        method: 'CASH', reference: 'receipt-after-reschedule', expectedRevision: record.revision }, f.actor);
      const updated = operations.paymentSummary(booking, await operations.getRecord(f.venueId, booking));
      assert.equal(updated.paidMinor, 4000);
      assert.equal(updated.balanceMinor, (newPrice - 40) * 100);
    }
   });
  }
  await t.test('hour duration merges overlaps and respects midnight', () => {
   assert.equal(finance.duration([{ date: day(21), startTime: '22:00', endTime: '00:00' }, { date: day(21), startTime: '23:00', endTime: '24:00' }], 'hour'), 2);
  });
 } finally { await mongoose.disconnect(); if (db) await db.stop(); }
});