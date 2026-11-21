const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scheduleWarnings, requireAcceptance } = require('../services/organiserScheduleWarnings.service');
const now = new Date('2030-06-10T12:00:00Z');
const venue = { availability: { advanceNotice: { days: 3, sameDayCutoffTime: '12:00' }, bookingWindow: 1, preparationTime: 2, unavailableDates: [{ date: '2030-06-15', bookingId: 'other' }] } };
test('notice and cutoff are warnings with affected dates', () => {
 const w = scheduleWarnings(venue, [{ date: '2030-06-10' }], 'day', { now });
 assert.deepEqual(w.map(x => x.code), ['ADVANCE_NOTICE', 'SAME_DAY_CUTOFF']);
 assert.ok(w.every(x => x.date === '2030-06-10'));
});
test('prep is overridable but actual overlap and past dates are blocked', () => {
 assert.ok(scheduleWarnings(venue, [{ date: '2030-06-14' }], 'day', { now }).some(w => w.code === 'PREPARATION_TIME'));
 assert.throws(() => scheduleWarnings(venue, [{ date: '2030-06-15' }], 'day', { now }), /available/);
 assert.throws(() => scheduleWarnings(venue, [{ date: '2030-06-09' }], 'day', { now }), /passed/);
});
test('venue and platform horizons produce separate warnings', () => {
 const w = scheduleWarnings(venue, [{ date: '2030-08-01' }], 'day', { now, platformLast: '2030-07-20' });
 assert.deepEqual(w.map(x => x.code), ['BOOKING_WINDOW', 'PLATFORM_WINDOW']);
});
test('hourly prep, operating hours and minimum can be reviewed', () => {
 const v = { basePrice: { unit: 'hour', minDuration: 2 }, availability: { preparationTime: 2, minDuration: 2, operationalHours: { open: '09:00', close: '18:00' }, unavailableSlots: [{ date: '2030-06-20', startTime: '10:00', endTime: '12:00' }] } };
 const w = scheduleWarnings(v, [{ date: '2030-06-20', startTime: '08:00', endTime: '09:00' }], 'hour', { now });
 for (const code of ['PREPARATION_TIME', 'OPERATING_HOURS', 'MINIMUM_HOURS', 'DURATION_LIMIT']) assert.ok(w.some(x => x.code === code), code);
});
test('acceptance binds warning details, dates and venue revision', () => {
 const v = { _id: 'v', updatedAt: 'one' }, changes = [{ date: '2030-06-20' }], w = [{ code: 'PREPARATION_TIME', message: 'Review' }];
 let token;
 assert.throws(() => requireAcceptance(v, changes, w), e => { token = e.reviewToken; return e.code === 'SCHEDULE_REVIEW_REQUIRED'; });
 assert.doesNotThrow(() => requireAcceptance(v, changes, w, token));
 assert.throws(() => requireAcceptance({ ...v, updatedAt: 'two' }, changes, w, token));
 assert.throws(() => requireAcceptance(v, [{ date: '2030-06-21' }], w, token));
});
