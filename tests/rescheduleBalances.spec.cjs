const { test } = require('node:test'), assert = require('node:assert/strict');
const { outstanding } = require('../services/rescheduleBalances.service');
const booking = { _id: 'manual-1', bookingType: 'MANUAL', status: 'ACTIVE', totalPrice: { amount: 100, currency: 'NGN' }, guestDetails: { fullName: 'Guest' } };
const record = { rescheduleAdjustment: true, agreedPrice: { amount: 150 }, openingPaidMinor: 3000 };
test('partially paid reschedule shows full balance from actual collections', () => {
 const row = outstanding(booking, record); assert.equal(row.summary.balanceMinor, 12000); assert.equal(row.bookingType, 'MANUAL');
});
test('lower new price shows refund and settled rows disappear', () => {
 assert.equal(outstanding(booking, { ...record, agreedPrice: { amount: 20 } }).summary.refundDueMinor, 1000);
 assert.equal(outstanding(booking, { ...record, agreedPrice: { amount: 30 } }), null);
});
test('sent refund remains visible until customer confirms receipt', () => {
 const r = { ...record, agreedPrice: { amount: 20 }, payments: [{ kind: 'REFUND', amountMinor: 1000 }], refunds: [{ status: 'SENT', amountMinor: 1000 }] };
 assert.equal(outstanding(booking, r).awaitingConfirmationMinor, 1000);
 r.refunds[0].status = 'CONFIRMED'; assert.equal(outstanding(booking, r), null);
});
test('past completed balances remain but cancellations use their separate workflow', () => {
 assert.ok(outstanding({ ...booking, status: 'COMPLETED' }, record));
 assert.equal(outstanding({ ...booking, status: 'CANCELLED' }, record), null);
 assert.equal(outstanding(booking, { ...record, rescheduleAdjustment: false }), null);
});
