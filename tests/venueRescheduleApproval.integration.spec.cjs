process.env.NODE_ENV = "test";
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
process.env.QR_SIGNING_SECRET = "reschedule-approval-tests-only";
const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Venue = require("../models/client/eventCenter.schema");
const Booking = require("../models/client/eventCenterBooking.schema");
const History = require("../models/client/bookingHistory.schema");
const Outbox = require("../models/client/eventCenterRefundOutbox.schema");
const controller = require("../controllers/client/venueReschedule.controller");
const { reserveVenueCheckout } = require("../services/venueCheckout.service");
const { rescheduleVenueBooking } = require("../services/venueLifecycle.service");
const oid = () => new mongoose.Types.ObjectId();
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const dates = (unit, offset) => [{ date: day(offset), ...(unit === "hour" ? { startTime: "10:00", endTime: "12:00" } : {}) }];
const checkout = (venue, selectedDates) => ({
  buyer: oid(), organiser: venue.createdBy,
  bookingUnit: venue.basePrice.unit, duration: venue.basePrice.unit === "hour" ? 2 : 1, selectedDates,
  totalPrice: { amount: venue.basePrice.unit === "hour" ? 200 : 100, currency: "NGN" },
  subtotalPrice: { amount: venue.basePrice.unit === "hour" ? 200 : 100, currency: "NGN" },
  paymentReference: String(oid()), bookingMode: "INSTANT", paymentStatus: "PENDING"
});
async function invoke(fn, actor, booking, body = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await fn({ user: { id: String(actor) }, params: { id: String(booking._id) }, body }, res);
  return res;
}
const calendar = venue => JSON.parse(JSON.stringify(venue.availability));

test("reschedule review and approval protect existing reservations", { timeout: 120000 }, async t => {
  let db;
  try {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri(), { dbName: "isolated_reschedule_approval" });
    await Promise.all([Venue.init(), Booking.init(), History.init(), Outbox.init()]);
    async function fixture(unit = "day", maxReschedules = 1) {
      const venue = await Venue.create({
        createdBy: oid(), venueName: "Reschedule test venue", status: "LISTED",
        cancellationPolicy: { allowGuestReschedule: true, maxReschedules },
        basePrice: { amount: 100, currency: "NGN", unit },
        availability: { unavailableDates: [], unavailableSlots: [] }
      });
      const booking = await reserveVenueCheckout(venue._id, venue.updatedAt, checkout(venue, dates(unit, 20)));
      await Booking.updateOne({ _id: booking._id }, { $set: { paymentStatus: "COMPLETED" } });
      const requested = await invoke(controller.request, booking.buyer, booking, { dates: dates(unit, 21), reason: "Change plans" });
      assert.equal(requested.code, 200, JSON.stringify(requested.body));
      return { venue, booking, requestId: requested.body.data.id, unit };
    }
    await t.test("default allowance is consumed once under simultaneous approvals and blocks every reschedule endpoint", async () => {
      const f = await fixture();
      assert.equal(f.booking.cancellationPolicy.maxReschedules, 1);
      const attempts = await Promise.allSettled([
        rescheduleVenueBooking(f.booking._id, [], f.venue.createdBy, f.requestId),
        rescheduleVenueBooking(f.booking._id, [], f.venue.createdBy, f.requestId),
      ]);
      assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleCount, 1);
      const result = await invoke(controller.get, f.booking.buyer, f.booking);
      assert.equal(result.body.eligibility.remainingReschedules, 0);
      assert.equal(result.body.eligibility.canRequest, false);
      const request = await invoke(controller.request, f.booking.buyer, f.booking, { dates: dates("day", 22), reason: "Again" });
      assert.equal(request.code, 409);
      assert.match(request.body.message, /used all/);
      const availability = await invoke(controller.availability, f.booking.buyer, f.booking);
      assert.equal(availability.code, 409);
      const before = calendar(await Venue.findById(f.venue._id));
      await assert.rejects(rescheduleVenueBooking(f.booking._id, dates("day", 22), f.venue.createdBy), /used all/);
      assert.deepEqual(calendar(await Venue.findById(f.venue._id)), before);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleCount, 1);
    });
    await t.test("custom allowance is snapshotted and survives request replacement and later listing edits", async () => {
      const f = await fixture("hour", 2);
      await Venue.updateOne({ _id: f.venue._id }, { $set: { "cancellationPolicy.maxReschedules": 1 } });
      assert.equal((await invoke(controller.resolve, f.booking.buyer, f.booking, { action: "WITHDRAWN", requestId: f.requestId })).code, 200);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleCount, 0);
      let request = await invoke(controller.request, f.booking.buyer, f.booking, { dates: dates("hour", 22), reason: "New request" });
      assert.equal(request.code, 200);
      await rescheduleVenueBooking(f.booking._id, [], f.venue.createdBy, request.body.data.id);
      let saved = await Booking.findById(f.booking._id);
      assert.equal(saved.cancellationPolicy.maxReschedules, 2);
      assert.equal(saved.rescheduleCount, 1);
      request = await invoke(controller.request, f.booking.buyer, f.booking, { dates: dates("hour", 23), reason: "Final change" });
      assert.equal(request.code, 200);
      await rescheduleVenueBooking(f.booking._id, [], f.venue.createdBy, request.body.data.id);
      saved = await Booking.findById(f.booking._id);
      assert.equal(saved.rescheduleCount, 2);
      assert.equal((await invoke(controller.get, saved.buyer, saved)).body.eligibility.canRequest, false);
      const current = await Venue.findById(f.venue._id);
      const next = await reserveVenueCheckout(current._id, current.updatedAt, checkout(current, dates("hour", 24)));
      assert.equal(next.cancellationPolicy.maxReschedules, 1);
      assert.equal(next.rescheduleCount, 0);
    });
    await t.test("approval rechecks an exhausted allowance without moving the booking", async () => {
      const f = await fixture();
      await Booking.updateOne({ _id: f.booking._id }, { $set: { rescheduleCount: 1 } });
      const before = calendar(await Venue.findById(f.venue._id));
      const review = await invoke(controller.get, f.venue.createdBy, f.booking);
      assert.equal(review.body.approval.canApprove, false);
      assert.match(review.body.approval.reason, /used all/);
      const result = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "ACCEPTED", requestId: f.requestId });
      assert.equal(result.code, 409);
      assert.deepEqual(calendar(await Venue.findById(f.venue._id)), before);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleCount, 1);
    });
    await t.test("cancelling the original booking closes its pending date request atomically", async () => {
      const f = await fixture();
      await require("../models/client/eventCenterRefund.schema").init();
      await require("../models/client/venuePayout.schema").init();
      await require("../services/venueCancellation.service").cancel(f.booking._id, { actor: f.venue.createdBy });
      const saved = await Booking.findById(f.booking._id);
      assert.equal(saved.rescheduleRequest.status, "CANCELLED");
      assert.equal(saved.rescheduleRequest.resolutionCode, "BOOKING_CANCELLED");
      assert.match(saved.rescheduleRequest.resolutionReason, /original booking was cancelled/i);
      const response = await invoke(controller.get, saved.buyer, saved);
      assert.equal(response.body.eligibility.canRequest, false);
      assert.equal(response.body.data.status, "CANCELLED");
      assert.equal((await Venue.findById(f.venue._id)).availability.unavailableDates.length, 0);
    });
    await t.test("approval refuses unresolved payments and refund intents without moving inventory", async () => {
      for (const extra of [{ paymentResolutionRequired: true }, { refund: { state: "QUEUED", amountMinor: 10000 } }]) {
        const f = await fixture();
        await Booking.updateOne({ _id: f.booking._id }, { $set: extra });
        const before = calendar(await Venue.findById(f.venue._id));
        const review = await invoke(controller.get, f.venue.createdBy, f.booking);
        assert.equal(review.body.approval.canApprove, false);
        const result = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "ACCEPTED", requestId: f.requestId });
        assert.equal(result.code, 409);
        assert.deepEqual(calendar(await Venue.findById(f.venue._id)), before);
        assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "PENDING");
      }
    });
    await t.test("archived venues reject new requests as well as approval", async () => {
      const f = await fixture();
      await invoke(controller.resolve, f.booking.buyer, f.booking, { action: "WITHDRAWN", requestId: f.requestId });
      await Venue.updateOne({ _id: f.venue._id }, { $set: { archivedAt: new Date() } });
      const response = await invoke(controller.request, f.booking.buyer, f.booking, { dates: dates("day", 22), reason: "Change again" });
      assert.equal(response.code, 409);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "WITHDRAWN");
    });
    for (const unit of ["day", "hour"]) {
      await t.test(`${unit}: an unpaid checkout blocks approval without cancelling either reservation`, async () => {
        const f = await fixture(unit);
        const initial = await invoke(controller.get, f.venue.createdBy, f.booking);
        assert.equal(initial.body.approval.canApprove, true);
        assert.equal(initial.body.approval.requestId, f.requestId);
        const before = await Venue.findById(f.venue._id);
        const other = await reserveVenueCheckout(before._id, before.updatedAt, checkout(before, dates(unit, 21)));
        const occupied = calendar(await Venue.findById(f.venue._id));
        const review = await invoke(controller.get, f.venue.createdBy, f.booking);
        assert.equal(review.body.approval.canApprove, false);
        assert.match(review.body.approval.reason, /available|conflict/);
        const accepted = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "ACCEPTED", requestId: f.requestId });
        assert.ok([400, 409].includes(accepted.code), JSON.stringify(accepted.body));
        const original = await Booking.findById(f.booking._id);
        assert.equal(original.rescheduleRequest.status, "PENDING");
        assert.equal(original.rescheduleCount, 0);
        assert.equal(original.selectedDates[0].date.toISOString().slice(0, 10), day(20));
        assert.equal((await Booking.findById(other._id)).selectedDates[0].date.toISOString().slice(0, 10), day(21));
        assert.deepEqual(calendar(await Venue.findById(f.venue._id)), occupied);
        assert.equal(await History.countDocuments({ ticket: f.booking._id, action: "RESCHEDULED" }), 0);
        assert.equal((await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "DECLINED", requestId: f.requestId })).code, 200);
        assert.deepEqual(calendar(await Venue.findById(f.venue._id)), occupied);
      });
      await t.test(`${unit}: checkout racing approval can reserve the requested time only once`, async () => {
        const f = await fixture(unit), venue = await Venue.findById(f.venue._id);
        const results = await Promise.allSettled([
          rescheduleVenueBooking(f.booking._id, [], venue.createdBy, f.requestId),
          reserveVenueCheckout(venue._id, venue.updatedAt, checkout(venue, dates(unit, 21))),
        ]);
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        const current = await Venue.findById(venue._id);
        const field = unit === "day" ? "unavailableDates" : "unavailableSlots";
        assert.equal(current.availability[field].filter(entry => entry.date.toISOString().slice(0, 10) === day(21)).length, 1);
        const original = await Booking.findById(f.booking._id);
        const moved = results[0].status === "fulfilled";
        assert.equal(original.rescheduleRequest.status, moved ? "ACCEPTED" : "PENDING");
        assert.equal(original.selectedDates[0].date.toISOString().slice(0, 10), day(moved ? 21 : 20));
      });
    }
    await t.test("review is authorised and does not expose other customer details", async () => {
      const f = await fixture();
      assert.equal((await invoke(controller.get, oid(), f.booking)).code, 403);
      assert.equal((await invoke(controller.get, f.booking.buyer, f.booking)).body.approval, undefined);
      await Venue.updateOne({ _id: f.venue._id }, {
        $push: {
          "availability.unavailableDates": {
            date: day(21), type: "MANUAL", bookingId: "manual-other", clientName: "Private Guest", clientEmail: "private@example.test",
          }
        }
      });
      const response = await invoke(controller.get, f.venue.createdBy, f.booking);
      assert.equal(response.body.data.status, "CANCELLED");
      assert.doesNotMatch(JSON.stringify(response.body), /Private Guest|private@example|manual-other/);
    });
    for (const kind of ["manual", "all-day", "preparation"]) {
      await t.test(`hourly review and approval respect ${kind} occupancy`, async () => {
        const f = await fixture("hour");
        const field = kind === "all-day" ? "unavailableDates" : "unavailableSlots";
        const entry = {
          date: day(21), type: kind === "manual" ? "MANUAL" : "BLOCKED",
          ...(kind === "all-day" ? {} : { startTime: kind === "preparation" ? "12:00" : "11:00", endTime: "13:00" }),
          bookingId: "other-reservation"
        };
        await Venue.updateOne({ _id: f.venue._id }, {
          $push: { [`availability.${field}`]: entry },
          ...(kind === "preparation" ? { $set: { "availability.preparationTime": 1 } } : {})
        });
        const before = calendar(await Venue.findById(f.venue._id));
        const review = await invoke(controller.get, f.venue.createdBy, f.booking);
        if (kind === "manual") assert.equal(review.body.data.status, "CANCELLED");
        else if (kind === "preparation") {
          assert.equal(review.body.approval.canApprove, true);
          assert.ok(review.body.approval.priceReview.warnings.some(w => w.code === "PREPARATION_TIME"));
        } else assert.equal(review.body.approval.canApprove, false);
        const accepted = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "ACCEPTED", requestId: f.requestId });
        {
          assert.ok([400, 409].includes(accepted.code));
          assert.deepEqual(calendar(await Venue.findById(f.venue._id)), before);
        }
        if (kind === "preparation") {
          const approved = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "ACCEPTED", requestId: f.requestId, reviewToken: review.body.approval.priceReview.reviewToken });
          assert.equal(approved.code, 200, JSON.stringify(approved.body));
          assert.notDeepEqual(calendar(await Venue.findById(f.venue._id)), before);
        }
      });
    }
    const conflicts = require("../services/venueRescheduleConflict.service");
    const block = async (f, extra = {}) => Venue.updateOne({ _id: f.venue._id }, {
      $push: {
        [f.unit === "hour" ? "availability.unavailableSlots" : "availability.unavailableDates"]: {
          date: day(21), type: "BOOKED", bookingId: "conflicting-reservation",
          ...(f.unit === "hour" ? { startTime: "11:00", endTime: "12:00" } : {}), ...extra,
        },
      }
    });
    await t.test("partial hourly availability is shown to both roles and a conflict decline explains exact hours", async () => {
      const f = await fixture("hour"); await block(f);
      for (const actor of [f.booking.buyer, f.venue.createdBy]) {
        const response = await invoke(controller.get, actor, f.booking);
        assert.equal(response.code, 200);
        const row = response.body.availability.dates[0];
        assert.equal(row.partial, true); assert.equal(row.available, false);
        assert.deepEqual(row.hours.map(hour => [hour.startTime, hour.available]), [["10:00", true], ["11:00", false]]);
      }
      const result = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "DECLINED", requestId: f.requestId });
      assert.equal(result.code, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.resolutionCode, "UNAVAILABLE");
      assert.match(result.body.data.resolutionReason, /11:00-12:00/);
      assert.match(result.body.data.resolutionReason, /choose different dates or hours/);
      assert.equal(result.body.data.resolutionAvailability[0].hours[0].available, true);
      const notice = await Outbox.findOne({ key: `reschedule-result:${f.requestId}` });
      assert.match(notice.message, /11:00-12:00/);
      assert.equal(await History.countDocuments({ ticket: f.booking._id, action: "UPDATED" }), 1);
    });
    await t.test("available dates require an organiser reason, saved for the customer and audit", async () => {
      const f = await fixture();
      for (const reason of [undefined, "   ", 123, "x".repeat(501)]) {
        const result = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "DECLINED", requestId: f.requestId, reason });
        assert.equal(result.code, 400);
        assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "PENDING");
      }
      const reason = "We cannot arrange staff for your new date.";
      const declined = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "DECLINED", requestId: f.requestId, reason });
      assert.equal(declined.code, 200);
      const result = await invoke(controller.get, f.booking.buyer, f.booking);
      assert.equal(result.body.data.resolutionReason, reason);
      assert.equal(result.body.data.resolutionCode, "ORGANISER_DECLINED");
      assert.equal(result.body.eligibility.canRequest, true);
      assert.equal(result.body.eligibility.remainingReschedules, 1);
      assert.match((await Outbox.findOne({ key: `reschedule-result:${f.requestId}` })).message, /cannot arrange staff/);
      const replacement = await invoke(controller.request, f.booking.buyer, f.booking, { dates: dates("day", 22), reason: "Another date" });
      assert.equal(replacement.code, 200);
      assert.equal(replacement.body.data.resolutionReason, undefined);
      assert.match((await History.findOne({ ticket: f.booking._id, action: "UPDATED" })).reason, /cannot arrange staff/);
      assert.equal((await conflicts.checkPendingRequest(f.booking._id, f.requestId)).skipped, true);
    });
    const pay = booking => require("../services/checkoutSafety.service").completePayment(booking.paymentReference, {
      status: "success", amount: Math.round(booking.totalPrice.amount * 100), currency: "NGN", reference: booking.paymentReference,
    });
    const reserveOther = async (f, extra = {}) => {
      const venue = await Venue.findById(f.venue._id);
      return reserveVenueCheckout(venue._id, venue.updatedAt, { ...checkout(venue, dates(f.unit, 21)), ...extra });
    };
    for (const unit of ["day", "hour"]) {
      await t.test(`${unit}: payment confirmation cancels conflicting requests immediately without a read or worker`, async () => {
        const f = await fixture(unit), other = await reserveOther(f);
        const before = calendar(await Venue.findById(f.venue._id));
        assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "PENDING");
        const result = await pay(other); assert.equal(result.conflict, false);
        const current = await Booking.findById(f.booking._id);
        assert.equal(current.rescheduleRequest.status, "CANCELLED");
        assert.equal(current.rescheduleCount, 0);
        assert.equal(current.status, "ACTIVE"); assert.equal(current.paymentStatus, "COMPLETED");
        assert.equal(current.selectedDates[0].date.toISOString().slice(0, 10), day(20));
        assert.match(current.rescheduleRequest.resolutionReason, /another confirmed booking/);
        const after = calendar(await Venue.findById(f.venue._id));
        const field = unit === "hour" ? "unavailableSlots" : "unavailableDates";
        assert.equal(after[field].length, before[field].length);
        assert.deepEqual(after[field].find(row => row.bookingId === String(f.booking._id)), before[field].find(row => row.bookingId === String(f.booking._id)));
        await pay(other);
        await conflicts.checkPendingRequest(f.booking._id, f.requestId);
        assert.equal(await History.countDocuments({ ticket: f.booking._id, action: "UPDATED" }), 1);
        assert.equal(await Outbox.countDocuments({ key: new RegExp(`^reschedule-auto-cancel:${f.requestId}:`) }), 2);
      });
    }
    await t.test("unpaid checkouts remain protected and retired organiser holds are ignored", async () => {
      const f = await fixture("hour"); await reserveOther(f);
      await conflicts.checkPendingRequest(f.booking._id, f.requestId, new Date(Date.now() + 24 * 3600000));
      assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "PENDING");
      const h = await fixture("hour");
      await block(h, { holdId: String(oid()), holdExpiresAt: new Date(Date.now() + 5 * 60000) });
      const review = await invoke(controller.get, h.venue.createdBy, h.booking);
      assert.equal(review.body.approval.canApprove, true);
      assert.equal((await Booking.findById(h.booking._id)).rescheduleRequest.status, "PENDING");
      const other = await reserveOther(h);
      const result = await pay(other); assert.equal(result.conflict, false);
      assert.equal((await Booking.findById(h.booking._id)).rescheduleRequest.status, "CANCELLED");
    });
    await t.test("paid bookings awaiting organiser review cancel requests only when confirmed", async () => {
      const f = await fixture();
      const other = await reserveOther(f, {
        bookingMode: "REVIEW", organiserPayoutAmount: 100,
        payoutDestination: { accountName: "Test Host", accountNumber: "0000000000", bankCode: "001" }
      });
      await pay(other);
      assert.equal((await Booking.findById(other._id)).status, "PENDING_REVIEW");
      assert.equal((await invoke(controller.get, f.venue.createdBy, f.booking)).body.approval.canApprove, false);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "PENDING");
      await require("../services/venuePayout.service").confirmReviewBooking(other._id, f.venue.createdBy);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "CANCELLED");
    });
    await t.test("manual bookings cancel conflicting requests as soon as the calendar is saved", async () => {
      const f = await fixture();
      const venue = await Venue.findById(f.venue._id);
      await require("../services/venueCalendarMutation.service").commitVenueUpdate(venue._id, {
        availability: {
          ...venue.availability.toObject(), unavailableDates: [...venue.availability.unavailableDates.map(row => row.toObject()), {
            date: day(21), type: "MANUAL", bookingId: "manual-instant", clientName: "Other Guest", totalPrice: 100, depositAmount: 0, paymentStatus: "pending",
          }]
        },
      }, venue.updatedAt, venue.createdBy);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "CANCELLED");
    });
    await t.test("confirmed rescheduling cancels other pending requests for the same time", async () => {
      const f = await fixture(); const venue = await Venue.findById(f.venue._id);
      const other = await reserveVenueCheckout(venue._id, venue.updatedAt, checkout(venue, dates("day", 22)));
      await pay(other);
      const otherRequest = await invoke(controller.request, other.buyer, other, { dates: dates("day", 21), reason: "New date" });
      assert.equal(otherRequest.code, 200);
      await rescheduleVenueBooking(f.booking._id, [], venue.createdBy, f.requestId);
      const saved = await Booking.findById(other._id);
      assert.equal(saved.rescheduleRequest.status, "CANCELLED");
      assert.equal(saved.selectedDates[0].date.toISOString().slice(0, 10), day(22));
    });
    await t.test("manual decline racing payment confirmation creates one decision and one audit", async () => {
      const f = await fixture(), other = await reserveOther(f);
      await Promise.all([pay(other), invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "DECLINED", requestId: f.requestId })]);
      assert.ok(["DECLINED", "CANCELLED"].includes((await Booking.findById(f.booking._id)).rescheduleRequest.status));
      assert.equal(await History.countDocuments({ ticket: f.booking._id, action: "UPDATED" }), 1);
    });
    await t.test("notification failure rolls back confirmation and request cancellation together", async () => {
      const f = await fixture(), other = await reserveOther(f);
      const stub = mock.method(Outbox, "bulkWrite", async () => { throw Error("notification unavailable"); });
      try { await assert.rejects(pay(other), /notification unavailable/); }
      finally { stub.mock.restore(); }
      assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "PENDING");
      assert.equal((await Booking.findById(other._id)).paymentStatus, "PENDING");
      assert.equal(await History.countDocuments({ ticket: f.booking._id, action: "UPDATED" }), 0);
      await pay(other);
      assert.equal((await Booking.findById(f.booking._id)).rescheduleRequest.status, "CANCELLED");
    });
    await t.test("there is no timer job or stored countdown state", () => {
      assert.equal(require("../config/workerSchedule").some(task => task.name === "venue-reschedule-expiry"), false);
      for (const field of ["conflictSince", "conflictSignature", "lastCheckedAt"])
        assert.equal(Booking.schema.path(`rescheduleRequest.${field}`), undefined);
    });
    await t.test("approval moves only the requested booking and releases its old dates", async () => {
      const f = await fixture(), current = await Venue.findById(f.venue._id);
      const other = await reserveVenueCheckout(current._id, current.updatedAt, checkout(current, dates("day", 22)));
      const before = await Venue.findById(f.venue._id);
      const otherEntry = JSON.parse(JSON.stringify(before.availability.unavailableDates.find(entry => entry.bookingId === String(other._id))));
      const result = await invoke(controller.resolve, f.venue.createdBy, f.booking, { action: "ACCEPTED", requestId: f.requestId });
      assert.equal(result.code, 200, JSON.stringify(result.body));
      const saved = await Venue.findById(f.venue._id);
      assert.equal(saved.availability.unavailableDates.some(entry => entry.date.toISOString().slice(0, 10) === day(20)), false);
      assert.deepEqual(JSON.parse(JSON.stringify(saved.availability.unavailableDates.find(entry => entry.bookingId === String(other._id)))), otherEntry);
      assert.equal(saved.availability.unavailableDates.find(entry => entry.bookingId === String(f.booking._id)).date.toISOString().slice(0, 10), day(21));
      assert.equal(await History.countDocuments({ ticket: f.booking._id, action: "RESCHEDULED" }), 1);
    });
  } finally {
    await mongoose.disconnect();
    if (db) await db.stop();
  }
});
