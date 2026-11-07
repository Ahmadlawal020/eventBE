process.env.QR_SIGNING_SECRET = "isolated-cancellation-test-key";
process.env.NODE_ENV = "test";
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Booking = require("../models/client/eventCenterBooking.schema");
const Venue = require("../models/client/eventCenter.schema");
const Refund = require("../models/client/eventCenterRefund.schema");
const Outbox = require("../models/client/eventCenterRefundOutbox.schema");
const History = require("../models/client/bookingHistory.schema");
const Payout = require("../models/client/venuePayout.schema");
const cancellation = require("../services/venueCancellation.service");
const refunds = require("../controllers/client/eventCenterRefund.controller");
const settlement = require("../controllers/client/eventCenterRefundSettlement.controller");
const controller = require("../controllers/client/venueCancellation.controller");
const oid = () => new mongoose.Types.ObjectId();
async function invoke(fn, user, id, body = {}, query = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await fn({ user: { id: String(user) }, params: { refundId: String(id), id: String(id) }, body, query }, res);
  return res;
}
test("event center direct cancellation and shared refund lifecycle", { timeout: 120000 }, async t => {
  let db;
  try {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri(), { dbName: "isolated_venue_cancellation" });
    await Promise.all([Booking.init(), Venue.init(), Refund.init(), Outbox.init(), History.init(), Payout.init()]);
    async function fixture(policy = {}) {
      const organiser = oid(), buyer = oid(), id = oid(), venueId = oid();
      const date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      await Venue.collection.insertOne({ _id: venueId, venueName: "Test venue", createdBy: organiser, status: "LISTED",
        availability: { unavailableDates: [{ date: new Date(date), bookingId: String(id), type: "BOOKED" }] } });
      const booking = await Booking.create({ _id: id, organiser, buyer, eventCenter: venueId,
        bookingUnit: "day", duration: 1, selectedDates: [{ date }], status: "ACTIVE", paymentStatus: "COMPLETED",
        paymentReference: String(id), subtotalPrice: { amount: 100, currency: "NGN" }, totalPrice: { amount: 110, currency: "NGN" },
        cancellationPolicy: { allowGuestCancellation: true, noticeHours: 24, refundDays: 5, ...policy } });
      return { booking, organiser, buyer, id, venueId };
    }
    await t.test("concurrent guest cancellation creates one obligation, releases inventory, and never queues provider refund", async () => {
      const f = await fixture();
      await Promise.all([1, 2].map(() => cancellation.cancel(f.id, { actor: f.buyer, guest: true })));
      assert.equal(await Refund.countDocuments({ ticketId: f.id }), 1);
      assert.equal(await History.countDocuments({ ticket: f.id }), 1);
      const complete = require("../services/checkoutSafety.service").completePayment;
      const payment = { reference: String(f.id), status: "success", amount: 11000, currency: "NGN" };
      await complete(String(f.id), payment, { kind: "EVENT_CENTER" });
      await complete(String(f.id), payment, { kind: "EVENT_CENTER" });
      const record = await Booking.findById(f.id);
      assert.equal(record.status, "CANCELLED"); assert.equal(record.refund?.state, undefined);
      assert.equal((await Venue.findById(f.venueId)).availability.unavailableDates.length, 0);
      const refund = await Refund.findOne({ ticketId: f.id });
      assert.equal(refund.amountMinor, 10000);
      assert.equal(+refund.dueAt - +record.cancellation.at, 5 * 86400000);
      const populated = await Refund.findById(refund._id).populate("eventCenterId").populate("ticketId").populate("bookingId").lean();
      assert.equal(populated.eventCenterId.venueName, "Test venue");
      assert.equal(String(populated.ticketId._id), String(f.id));
    });
    await t.test("real listing updates reject owner tampering and guest detail endpoints redact venue contacts", async () => {
      const f = await fixture();
      const collaborator = oid();
      await require("../models/client/coOrganiserInvitation.schema").collection.insertOne({
        coOrganiser: collaborator, host: f.organiser, status: "ACCEPTED",
        permissions: ["MANAGE_LISTING"], listings: [{ listingId: f.venueId, listingType: "EventCenter" }],
      });
      const editor = require("../controllers/client/eventCenter.controller");
      const changed = await invoke(editor.updateEventCenter, collaborator, f.venueId, { createdBy: String(collaborator) });
      assert.equal(changed.code, 400);
      assert.equal(String((await Venue.findById(f.venueId)).createdBy), String(f.organiser));
      const contact = "private-other-guest@example.test";
      await Venue.updateOne({ _id: f.venueId }, { $push: { "availability.unavailableDates": { date: new Date(Date.now() + 40 * 86400000), type: "MANUAL", bookingId: "private-entry", clientName: "Other guest", clientEmail: contact } } });
      const ownDetail = await invoke(require("../controllers/client/eventCenterTicket.controller").getTicketById, f.buyer, f.id);
      assert.equal(ownDetail.code, 200);
      assert.equal(JSON.stringify(ownDetail.body).includes(contact), false);
      const generic = await invoke(require("../controllers/client/ticket.controller").getTicketDetails, f.buyer, f.id);
      assert.equal(generic.code, 200);
      assert.equal(JSON.stringify(generic.body).includes(contact), false);
    });
    await t.test("unapproved paid bookings can be withdrawn only by their guest with one provider refund", async () => {
      const f = await fixture();
      await Booking.updateOne({ _id: f.id }, { $set: { status: "PENDING_REVIEW", bookingMode: "REVIEW", reviewDeadline: new Date(Date.now() + 86400000) } });
      const preview = await invoke(controller.preview, f.buyer, f.id);
      assert.equal(preview.body.data.canWithdraw, true);
      assert.equal((await invoke(controller.cancel, oid(), f.id)).code, 404);
      const result = await invoke(controller.cancel, f.buyer, f.id, { expectedRefundMinor: 11000 });
      assert.equal(result.code, 200);
      await invoke(controller.cancel, f.buyer, f.id);
      const booking = await Booking.findById(f.id);
      assert.equal(booking.status, "CANCELLED"); assert.equal(booking.refund.state, "QUEUED"); assert.equal(booking.refund.amountMinor, 11000);
      assert.equal(await Refund.countDocuments({ ticketId: f.id }), 0);
      assert.equal(await History.countDocuments({ ticket: f.id, action: "CANCELLED" }), 1);
    });
    await t.test("review acceptance after the booked start is rejected even with a stale future deadline", async () => {
      const f = await fixture();
      await Booking.updateOne({ _id: f.id }, { $set: { status: "PENDING_REVIEW", bookingMode: "REVIEW",
        reviewDeadline: new Date(Date.now() + 86400000), selectedDates: [{ date: new Date(Date.now() - 86400000) }] } });
      await assert.rejects(require("../services/venuePayout.service").confirmReviewBooking(f.id, f.organiser), { statusCode: 409 });
    });
    await t.test("manual reservations and their offline refunds appear alongside online bookings", async () => {
      const f = await fixture();
      const manualId = "manual-audit-" + f.id, date = new Date(Date.now() + 45 * 86400000);
      await Venue.updateOne({ _id: f.venueId }, { $push: { "availability.unavailableDates": {
        date, type: "MANUAL", bookingId: manualId, clientName: "Offline guest", totalPrice: 200, depositAmount: 50, paymentStatus: "partially_paid",
      } } });
      await History.create({ eventCenter: f.venueId, bookingId: manualId, bookingType: "MANUAL", bookingUnit: "day", action: "CREATED",
        dates: [{ date }], guestName: "Offline guest", totalPrice: { amount: 200, currency: "NGN" }, performedBy: f.organiser });
      const Ops = require("../models/client/bookingOperations.schema");
      await Ops.create({ _id: f.venueId + ":" + manualId, eventCenter: f.venueId, bookingId: manualId, openingPaidMinor: 5000 });
      const workspace = require("../controllers/client/eventCenterRefundWorkspace.controller");
      const page = await invoke(workspace.list, f.organiser, f.venueId);
      assert.equal(page.code, 200); assert.equal(page.body.data.pagination.total, 2);
      assert.equal(page.body.data.rows.find(b => b._id === manualId).bookingType, "MANUAL");
      const next = await invoke(workspace.list, f.organiser, f.venueId, {}, { limit: "1", page: "2" });
      assert.equal(next.body.data.rows.length, 1);
      await Venue.updateOne({ _id: f.venueId }, { $pull: { "availability.unavailableDates": { bookingId: manualId } } });
      const due = await invoke(workspace.list, f.organiser, f.venueId, {}, { filter: "DUE" });
      assert.equal(due.body.data.rows[0]._id, manualId);
      assert.equal(due.body.data.rows[0].manualFinance.netCollectedMinor, 5000);
      await Ops.updateOne({ bookingId: manualId }, { $push: { payments: { id: "refund-audit-1", kind: "REFUND", amountMinor: 5000, method: "CASH", reason: "Cancelled", at: new Date(), actor: f.organiser } } });
      const refunded = await invoke(workspace.list, f.organiser, f.venueId, {}, { filter: "REFUNDED" });
      assert.equal(refunded.body.data.rows[0]._id, manualId);
      assert.equal(refunded.body.data.rows[0].manualFinance.netCollectedMinor, 0);
    });
    await t.test("calendar removal retains a legacy manual payment and its booking detail link", async () => {
      const f = await fixture();
      const manualId = "manual-snapshot-" + f.id;
      await Venue.updateOne({ _id: f.venueId }, { $push: { "availability.unavailableDates": {
        date: new Date(Date.now() + 47 * 86400000), type: "MANUAL", bookingId: manualId,
        clientName: "Legacy offline guest", totalPrice: 200, depositAmount: 50, paymentStatus: "partially_paid",
      } } });
      const before = await Venue.findById(f.venueId).lean();
      const saved = await invoke(require("../controllers/client/eventCenter.controller").updateEventCenter, f.organiser, f.venueId, {
        expectedUpdatedAt: before.updatedAt.toISOString(), availability: { unavailableDates: [] },
      });
      assert.equal(saved.code, 200);
      const list = await invoke(require("../controllers/client/eventCenterRefundWorkspace.controller").list, f.organiser, f.venueId, {}, { filter: "DUE" });
      assert.equal(list.body.data.rows[0]._id, manualId);
      assert.equal(list.body.data.rows[0].manualFinance.netCollectedMinor, 5000);
      // This controller uses bookingId rather than id in its route.
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await require("../controllers/client/bookingHistory.controller").getBookingFullDetails({ params: { bookingId: manualId }, user: { id: String(f.organiser) } }, res);
      assert.equal(res.code, 200);
      assert.equal(res.body.data.booking.status, "CANCELLED");
      assert.equal(res.body.data.booking.depositAmount, 50);
    });
    await t.test("management can find event center refund support cases through their own API", async () => {
      const f = await fixture(); await cancellation.cancel(f.id, { actor: f.organiser });
      const refund = await Refund.findOne({ ticketId: f.id });
      const unique = "audit-case-" + f.id;
      await Refund.updateOne({ _id: refund._id }, { $set: { resourceTitle: unique, supportRequest: { status: "OPEN", reason: "Account correction", requestedAt: new Date() } } });
      const management = require("../controllers/management/eventCenterRefunds.controller");
      const list = await invoke(management.getRefunds, f.organiser, refund._id, {}, { search: unique, support: "open" });
      assert.equal(list.code, 200); assert.equal(list.body.data.refunds.length, 1);
      assert.equal(list.body.data.refunds[0].bookingType, "event-center-cancellation");
      const details = await invoke(management.getRefundDetail, f.organiser, refund._id);
      assert.equal(details.code, 200); assert.equal(details.body.data.refund.eventCenter.venueName, "Test venue");
      assert.equal(details.body.data.refund.supportRequest.reason, "Account correction");
    });
    await t.test("booking and finance dashboards reconcile confirmed venue refunds", async () => {
      const f = await fixture();
      await require("../models/client/user.schema").collection.insertOne({ _id: f.organiser, firstName: "Venue owner", email: "finance-audit@example.test" });
      await Booking.updateOne({ _id: f.id }, { $set: { platformFeeAmount: 10, organiserPayoutAmount: 100 } });
      await cancellation.cancel(f.id, { actor: f.organiser });
      await Refund.updateOne({ ticketId: f.id }, { $set: { status: "CONFIRMED_BY_BUYER", markedPaidAt: new Date(), confirmedAt: new Date() } });
      const dashboard = await invoke(require("../controllers/client/bookingDashboard.controller").getOrganiserBookingStats, f.organiser, f.venueId);
      assert.equal(dashboard.code, 200);
      assert.equal(dashboard.body.data.aggregate.totalRevenue, 0);
      assert.equal(dashboard.body.data.aggregate.moneyByCurrency[0].grossCollections, 110);
      assert.equal(dashboard.body.data.aggregate.refundsSent, 100);
      const finance = await invoke(require("../controllers/client/financeDashboard.controller").getFinanceStats, f.organiser, f.venueId);
      assert.equal(finance.code, 200);
      assert.equal(finance.body.data.balance.totalEarnings, 0);
      assert.equal(finance.body.data.venueMoneyByCurrency[0].netReceipts, 0);
      assert.equal(finance.body.data.transactions.find(t => t.category === "VENUE_REFUND").amount, 100);
    });
    await t.test("venue holder flow groups booking types and current holders with bounded pages", async () => {
      const workspace = require("../controllers/client/eventCenterHolderRefundWorkspace.controller");
      const User = require("../models/client/user.schema");
      const f = await fixture();
      await User.collection.insertOne({ _id: f.buyer, firstName: "Holder", surname: "One", email: "holder-one@example.test" });
      await cancellation.cancel(f.id, { actor: f.organiser });
      const second = oid(), other = oid(), third = oid();
      await User.collection.insertOne({ _id: other, firstName: "Holder", surname: "Two", email: "holder-two@example.test" });
      await Booking.create({ ...f.booking.toObject(), _id: second, paymentReference: String(second) });
      await Booking.create({ ...f.booking.toObject(), _id: third, buyer: other, bookingUnit: "hour", paymentReference: String(third) });
      const summary = await invoke(workspace.summary, f.organiser, f.venueId);
      assert.equal(summary.code, 200);
      const day = summary.body.data.tiers.find(tier => tier._id === "day");
      assert.equal(day.total, 2); assert.equal(day.holders, 1); assert.equal(day.pending, 1);
      assert.equal((await invoke(workspace.summary, oid(), f.venueId)).code, 404);
      const holders = await invoke(workspace.holders, f.organiser, f.venueId, {}, { ticketTypeId: "day", limit: 1, filter: "cancelled" });
      assert.equal(holders.code, 200);
      assert.equal(holders.body.data.total, 1);
      assert.equal(holders.body.data.items[0].count, 2);
      assert.equal(holders.body.data.items[0].person.firstName, "Holder");
      assert.equal(JSON.stringify(holders.body).includes("bankDetails"), false);
      const firstPage = await invoke(workspace.holderTickets, f.organiser, f.venueId, {}, { ticketTypeId: "day", holderId: String(f.buyer), limit: 1 });
      assert.equal(firstPage.code, 200); assert.equal(firstPage.body.data.total, 2); assert.equal(firstPage.body.data.tickets.length, 1);
      const detail = await invoke(workspace.holderTickets, f.organiser, f.venueId, {}, { ticketTypeId: "day", holderId: String(f.buyer) });
      assert.equal(detail.body.data.refunds.length, 1);
      assert.equal(detail.body.data.tickets[0].items[0].ticketId, "day");
      const unmatched = await invoke(workspace.holders, f.organiser, f.venueId, {}, { ticketTypeId: "day", search: "does-not-exist" });
      assert.equal(unmatched.body.data.total, 0);
      assert.equal((await invoke(workspace.holders, f.organiser, f.venueId, {}, { ticketTypeId: "invalid" })).code, 400);
    });
    await t.test("organiser workspace scopes bookings, filters refunds, paginates and protects bank details", async () => {
      const workspace = require("../controllers/client/eventCenterRefundWorkspace.controller");
      const f = await fixture();
      await Booking.updateOne({ _id: f.id }, { $set: { guestDetails: { fullName: "Guest [one]" } } });
      await cancellation.cancel(f.id, { actor: f.organiser });
      const refund = await Refund.findOne({ ticketId: f.id });
      await Refund.updateOne({ _id: refund._id }, { $set: { bankDetails: { accountName: "Guest", accountNumber: "0123456789", bankCode: "058" } } });
      const secondId = oid();
      await Booking.create({ ...f.booking.toObject(), _id: secondId, paymentReference: String(secondId) });
      const denied = await invoke(workspace.list, oid(), f.venueId);
      assert.equal(denied.code, 404);
      assert.equal((await invoke(workspace.details, oid(), f.id)).code, 404);
      const all = await invoke(workspace.list, f.organiser, f.venueId, {}, { limit: "1" });
      assert.equal(all.code, 200);
      assert.equal(all.body.data.pagination.total, 2);
      assert.equal(all.body.data.rows.length, 1);
      assert.equal(all.body.data.summary.cancelled, 1);
      const due = await invoke(workspace.list, f.organiser, f.venueId, {}, { filter: "DUE" });
      assert.equal(due.body.data.rows.length, 1);
      assert.equal(due.body.data.rows[0].directRefund.status, "AWAITING_BUYER_DETAILS");
      assert.equal(JSON.stringify(due.body).includes("0123456789"), false);
      const literal = await invoke(workspace.list, f.organiser, f.venueId, {}, { search: "[one]" });
      assert.equal(literal.body.data.pagination.total, 1);
      assert.equal((await invoke(workspace.list, f.organiser, f.venueId, {}, { filter: "INVALID" })).code, 400);
      const detail = await invoke(workspace.details, f.organiser, f.id);
      assert.equal(detail.body.data.booking.status, "CANCELLED");
      assert.equal(detail.body.data.preview, null);
      await Refund.updateOne({ _id: refund._id }, { $set: { status: "CONFIRMED_BY_BUYER", markedPaidAt: new Date(), confirmedAt: new Date() } });
      const paid = await invoke(workspace.list, f.organiser, f.venueId, {}, { filter: "REFUNDED" });
      assert.equal(paid.body.data.rows.length, 1);
      assert.equal(paid.body.data.summary.confirmed, 1);
    });
    await t.test("event and venue refund records and APIs stay isolated", async () => {
      const f = await fixture();
      await cancellation.cancel(f.id, { actor: f.organiser });
      const venueRefund = await Refund.findOne({ ticketId: f.id });
      const EventRefund = require("../models/client/eventRefund.schema");
      const eventController = require("../controllers/client/eventRefund.controller");
      assert.notEqual(EventRefund.collection.name, Refund.collection.name);
      assert.equal(await EventRefund.countDocuments({ ticketId: f.id }), 0);
      const details = { accountName: "Test Holder", accountNumber: "0123456789", bankCode: "058" };
      assert.equal((await invoke(eventController.submitBankDetails, f.buyer, venueRefund._id, details)).code, 409);
      const eventRefund = await EventRefund.create({ eventId: oid(), bookingId: oid(), ticketId: oid(),
        buyer: f.buyer, organiser: f.organiser, amountMinor: 10000, currency: "NGN", dueAt: new Date() });
      assert.equal((await invoke(refunds.submitBankDetails, f.buyer, eventRefund._id, details)).code, 409);
      assert.equal((await EventRefund.findById(eventRefund._id)).status, "AWAITING_BUYER_DETAILS");
      assert.equal((await Refund.findById(venueRefund._id)).status, "AWAITING_BUYER_DETAILS");
    });
    await t.test("ownership and policy checked on server; organiser can cancel with guest cancellation disabled", async () => {
      const f = await fixture({ allowGuestCancellation: false });
      await assert.rejects(cancellation.cancel(f.id, { actor: oid(), guest: true }), { statusCode: 403 });
      await assert.rejects(cancellation.cancel(f.id, { actor: f.buyer, guest: true }), { statusCode: 409 });
      await cancellation.cancel(f.id, { actor: f.organiser });
      assert.equal(await Refund.countDocuments({ ticketId: f.id }), 1);
    });
    await t.test("notice persistence failure rolls back booking, refund and inventory", async () => {
      const f = await fixture(); const stub = mock.method(Outbox, "bulkWrite", async () => { throw Error("outbox unavailable"); });
      try { await assert.rejects(cancellation.cancel(f.id, { actor: f.buyer, guest: true }), /outbox unavailable/); }
      finally { stub.mock.restore(); }
      assert.equal((await Booking.findById(f.id)).status, "ACTIVE");
      assert.equal(await Refund.countDocuments({ ticketId: f.id }), 0);
      assert.equal((await Venue.findById(f.venueId)).availability.unavailableDates.length, 1);
    });
    await t.test("review payout must complete before organiser owes a direct refund", async () => {
      const f = await fixture();
      await Booking.updateOne({ _id: f.id }, { $set: { bookingMode: "REVIEW", status: "CONFIRMED" } });
      await assert.rejects(cancellation.cancel(f.id, { actor: f.buyer, guest: true }), { statusCode: 409 });
      await Payout.create({ booking: f.id, organiser: f.organiser, reference: "payout-" + f.id, amountMinor: 10000, currency: "NGN", destination: { accountNumber: "0123456789", bankCode: "058" }, status: "SUCCESS" });
      await cancellation.cancel(f.id, { actor: f.buyer, guest: true });
    });
    await t.test("shared bank-details, settlement, paid, dispute and confirmation transitions work for venue refunds", async () => {
      const f = await fixture(); await cancellation.cancel(f.id, { actor: f.organiser });
      const refund = await Refund.findOne({ ticketId: f.id });
      assert.equal((await invoke(controller.organiserRefund, oid(), f.id)).code, 404);
      assert.equal((await invoke(controller.organiserRefund, f.organiser, f.id)).body.data.amountMinor, 10000);
      const details = { accountName: "Test Holder", accountNumber: "0123456789", bankCode: "058" };
      assert.equal((await invoke(refunds.submitBankDetails, oid(), refund._id, details)).code, 409);
      assert.equal((await invoke(refunds.submitBankDetails, f.buyer, refund._id, details)).code, 200);
      const prepared = await invoke(settlement.prepare, f.organiser, refund._id, { bankDetailsVersion: 1 });
      assert.equal(prepared.code, 200); const settlementId = prepared.body.data.settlement.id;
      assert.equal((await invoke(refunds.submitBankDetails, f.buyer, refund._id, details)).code, 409);
      assert.equal((await invoke(refunds.markRefundPaid, f.organiser, refund._id, { settlementId })).code, 409);
      // Isolated fixture represents an uploaded private receipt; no storage provider is contacted.
      await Refund.updateOne({ _id: refund._id }, { $set: { receipt: { publicId: "test/private-proof", format: "png", uploadedAt: new Date(), settlementId } } });
      assert.equal((await invoke(refunds.markRefundPaid, f.organiser, refund._id, { settlementId })).code, 200);
      assert.equal((await invoke(refunds.disputeRefund, f.buyer, refund._id, { reason: "Not yet received" })).code, 200);
      assert.equal((await invoke(refunds.confirmRefund, f.buyer, refund._id)).code, 200);
      assert.equal((await Refund.findById(refund._id)).status, "CONFIRMED_BY_BUYER");
    });
  } finally { await mongoose.disconnect(); if (db) await db.stop(); }
});
