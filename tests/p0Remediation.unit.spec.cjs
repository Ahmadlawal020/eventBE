process.env.QR_SIGNING_SECRET = "p0-remediation-unit-test-secret";
process.env.PAYSTACK_SUPPORTED_CURRENCIES = "NGN";
const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const EventCenterBooking = require("../models/client/eventCenterBooking.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const VenuePayout = require("../models/client/venuePayout.schema");
const VenueRescheduleCheckout = require("../models/client/venueRescheduleCheckout.schema");
const BookingOperations = require("../models/client/bookingOperations.schema");
const TicketTransferRequest = require("../models/client/ticketTransferRequest.schema");
const User = require("../models/client/user.schema");
const PlatformFees = require("../models/management/platformFees.schema");
const EventCenterSettings = require("../models/management/eventCenterSettings.schema");
const EventCenterRefundOutbox = require("../models/client/eventCenterRefundOutbox.schema");

const clientVenueReschedule = require("../services/clientVenueReschedule.service");
const venueCancellation = require("../services/venueCancellation.service");
const listingVisibility = require("../services/listingVisibility");
const verifyAdmin = require("../middleware/management/verifyAdmin");
const verifyModerator = require("../middleware/management/verifyModerator");

afterEach(() => mock.restoreAll());

const id1 = "507f1f77bcf86cd799439011";
const id2 = "507f1f77bcf86cd799439012";
const id3 = "507f1f77bcf86cd799439013";
const future1 = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);
const future2 = new Date(Date.now() + 86400000 * 6).toISOString().slice(0, 10);

const chainQuery = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  skip() { return this; },
  limit() { return this; },
  session() { return this; },
  lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

test("P0 #4: clientVenueReschedule does not charge phantom buyer fee when newPrice <= paidMinor and recomputes refundMinor", async () => {
  // Original booking paid 115,000 NGN (100,000 subtotal + 15,000 fee).
  // Previously rescheduled down to 65,000 NGN agreedPrice (50,000 subtotal + 15,000 fee).
  // Now rescheduling to 80,000 subtotal (95,000 total with original fee).
  // Even though price increased vs previous agreedPrice (95,000 > 65,000), it is still < paid (115,000),
  // so payNowMinor === 0, additionalFeeMinor must be 0, and refundMinor must be 20,000 (2000000 minor).
  const booking = {
    _id: id1,
    buyer: id2,
    organiser: id3,
    eventCenter: id1,
    status: "CONFIRMED",
    paymentStatus: "COMPLETED",
    bookingUnit: "day",
    duration: 1,
    selectedDates: [{ date: future1 }],
    totalPrice: { amount: 115000, currency: "NGN" },
    subtotalPrice: { amount: 100000, currency: "NGN" },
    rescheduledPrice: { amount: 65000, currency: "NGN" },
    cancellationPolicy: { allowGuestReschedule: true, rescheduleNoticeHours: 24, maxReschedules: 3, rescheduleApprovalRequired: false },
    rescheduleCount: 1,
  };
  const venue = {
    _id: id1,
    status: "LISTED",
    archivedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    basePrice: { amount: 80000, currency: "NGN", unit: "day" },
    availability: { unavailableDates: [], unavailableSlots: [] },
    toObject() { return this; },
  };
  const ledger = {
    _id: `${id1}:${id1}`,
    eventCenter: id1,
    bookingId: id1,
    revision: 1,
    openingPaidMinor: 11500000,
    agreedPrice: { amount: 65000, currency: "NGN" },
    rescheduleAdjustment: true,
    rescheduleBuyerFeesMinor: 0,
    payments: [],
    refunds: [],
  };

  mock.method(EventCenterBooking, "findOne", () => chainQuery(booking));
  mock.method(EventCenter, "findById", () => chainQuery(venue));
  mock.method(BookingOperations, "findById", () => chainQuery(ledger));
  mock.method(PlatformFees, "findOneAndUpdate", async () => ({ eventCenterCommission: 15 }));
  mock.method(EventCenterSettings, "getSingleton", async () => new EventCenterSettings());

  const prepared = await clientVenueReschedule.prepare(id1, [{ date: future2 }], id2);
  assert.equal(prepared.review.additionalFeeMinor, 0);
  assert.equal(prepared.review.payNowMinor, 0);
  assert.equal(prepared.review.newPriceMinor, 9500000);
  assert.equal(prepared.review.refundMinor, 2000000);
});

test("P0 #5 & #7: clientVenueReschedule.complete honors on-time paid_at even when webhook arrives late, and blocks transferred buyer", async () => {
  mock.method(mongoose.connection, "transaction", (fn) => fn({}));

  const pastExpiry = new Date(Date.now() - 60000); // expired 1 min ago
  const onTimePaidAt = new Date(pastExpiry.getTime() - 120000).toISOString(); // paid 2 mins before expiry

  const attempt = {
    _id: id3,
    booking: id1,
    buyer: id2,
    eventCenter: id1,
    paymentReference: "MNS-RS-TEST",
    status: "ACTIVE",
    paymentStatus: "PENDING",
    totalPrice: { amount: 11500, currency: "NGN" },
    reservationExpiresAt: pastExpiry,
    originalCount: 0,
    ledgerRevision: 0,
    review: {
      dates: [{ date: future2 }],
      newPriceMinor: 12650000,
      previousPriceMinor: 11500000,
      additionalFeeMinor: 150000,
      currency: "NGN",
      refundMinor: 0,
    },
    save: async function () { return this; },
  };

  // Case 1: Booking was transferred to someone else ("new-buyer") while checkout was active -> must cancel & queue refund
  const transferredBooking = {
    _id: id1,
    buyer: "507f1f77bcf86cd799439099",
    organiser: id3,
    eventCenter: id1,
    status: "CONFIRMED",
    paymentStatus: "COMPLETED",
    bookingUnit: "day",
    rescheduleCheckoutId: id3,
    rescheduleCount: 0,
    selectedDates: [{ date: future1, toObject() { return this; } }],
    totalPrice: { amount: 115000, currency: "NGN" },
    save: async function () { return this; },
  };
  const listedVenue = {
    _id: id1,
    status: "LISTED",
    archivedAt: null,
    availability: { unavailableDates: [], unavailableSlots: [] },
    toObject() { return JSON.parse(JSON.stringify(this)); },
    save: async function () { return this; },
  };

  mock.method(VenueRescheduleCheckout, "findOne", () => chainQuery(attempt));
  mock.method(EventCenterBooking, "findById", () => chainQuery(transferredBooking));
  mock.method(EventCenter, "findById", () => chainQuery(listedVenue));
  mock.method(EventCenter, "updateOne", async () => ({ modifiedCount: 1 }));
  mock.method(EventCenterBooking, "updateOne", async () => ({ modifiedCount: 1 }));
  mock.method(BookingOperations, "findById", () => chainQuery(null));
  mock.method(require("../services/eventCenterRefundNotifications.service"), "queueNotices", async () => {});

  const transferredResult = await clientVenueReschedule.complete(
    "MNS-RS-TEST",
    { status: "success", reference: "MNS-RS-TEST", amount: 1150000, currency: "NGN", paid_at: onTimePaidAt },
  );
  assert.equal(transferredResult.completed, false);
  assert.equal(transferredResult.refundState, "QUEUED");

  // Case 2: Same buyer, on-time payment, webhook arrived after reservationExpiresAt -> must complete!
  attempt.status = "ACTIVE";
  attempt.refund = undefined;
  transferredBooking.buyer = id2;
  mock.method(BookingOperations, "updateOne", async () => ({ modifiedCount: 1 }));
  mock.method(require("../services/venueBookingEvents.service"), "recordVenueEvent", async () => {});

  const validResult = await clientVenueReschedule.complete(
    "MNS-RS-TEST",
    { status: "success", reference: "MNS-RS-TEST", amount: 1150000, currency: "NGN", paid_at: onTimePaidAt },
  );
  assert.equal(validResult.completed, true);
  assert.equal(attempt.status, "COMPLETED");
});

test("P0 #3: REVIEW-mode cancellation with unsettled/failed payout cancels payout and queues provider refund instead of deadlocking", async () => {
  mock.method(mongoose.connection, "transaction", (fn) => fn({}));

  const booking = {
    _id: id1,
    buyer: id2,
    organiser: id3,
    eventCenter: id1,
    bookingMode: "REVIEW",
    bookingUnit: "day",
    status: "CONFIRMED",
    paymentStatus: "COMPLETED",
    paymentReference: "MNS-REV-1",
    selectedDates: [{ date: future1 }],
    totalPrice: { amount: 115000, currency: "NGN" },
    subtotalPrice: { amount: 100000, currency: "NGN" },
    cancellationPolicy: { allowGuestCancellation: true, noticeHours: 24, refundDays: 7 },
    save: async function () { return this; },
  };
  const failedPayout = {
    _id: id3,
    booking: id1,
    status: "NEEDS_ATTENTION",
    save: async function () { return this; },
  };

  mock.method(VenuePayout, "findOne", () => chainQuery(failedPayout));
  mock.method(BookingOperations, "findById", () => chainQuery(null));

  const preview = await venueCancellation.preview(booking, true);
  assert.equal(preview.canCancel, true);

  mock.method(EventCenterBooking, "findById", () => chainQuery(booking));
  mock.method(EventCenter, "findById", () => chainQuery({ _id: id1, venueName: "Hall A" }));
  mock.method(EventCenter, "updateOne", async () => ({ modifiedCount: 1 }));
  mock.method(require("../models/client/bookingHistory.schema"), "create", async () => [{}]);
  mock.method(EventCenterRefundOutbox, "bulkWrite", async () => ({ upsertedCount: 1 }));

  const cancelled = await venueCancellation.cancel(id1, { actor: id2, guest: true, reason: "Change of plans" });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(failedPayout.status, "CANCELLED");
  assert.equal(cancelled.refund.state, "QUEUED");
  assert.equal(cancelled.refund.amountMinor, 11500000);
});

test("P0 #9 & #12: RBAC middleware rejects typo/unauthorized roles and listingVisibility blocks archived/moderated venues", () => {
  assert.equal(verifyAdmin.ADMIN_ROLES.includes("modarator"), false);

  const reqMod = { user: { roles: ["moderator"] }, managementStaff: { roles: ["moderator"] } };
  let statusSent = null;
  const resMock = { status(c) { statusSent = c; return this; }, json() { return this; } };
  const guard = verifyAdmin.requireAdminRoles(["admin", "super_admin", "superadmin"]);
  guard(reqMod, resMock, () => {});
  assert.equal(statusSent, 403);

  let modAllowed = false;
  verifyModerator(reqMod, resMock, () => { modAllowed = true; });
  assert.equal(modAllowed, true);

  // Listing visibility
  assert.equal(listingVisibility.canViewListing({ status: "LISTED", archivedAt: null, moderation: { status: "APPROVED" } }, null), true);
  assert.equal(listingVisibility.canViewListing({ status: "LISTED", archivedAt: new Date(), moderation: { status: "APPROVED" } }, null), false);
  assert.equal(listingVisibility.canViewListing({ status: "LISTED", archivedAt: null, moderation: { status: "UNLISTED" } }, null), false);
});
