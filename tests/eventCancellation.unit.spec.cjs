const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const constants = require("../constants/notificationTypes");

function load(path, dependencies) {
  const context = { module: { exports: {} }, console: { error() {}, warn() {}, log() {} },
    require(name) { if (name in dependencies) return dependencies[name]; throw new Error("Unexpected dependency: " + name); } };
  vm.runInNewContext(fs.readFileSync(require.resolve(path), "utf8"), context);
  return context.module.exports;
}
function query(value) {
  return { select() { return this; }, lean() { return this; }, session() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}
function lifecycle({ failDelivery = false, owner = "host" } = {}) {
  let sent, refunds = [], countFilter;
  const event = { _id: "event", title: "Concert", createdBy: "host", status: "LISTED", async save() {} };
  const bookings = [
    { _id: "paid", buyer: "buyer", paymentStatus: "COMPLETED", totalAmount: 1100, subtotalAmount: 1000, currency: "NGN", items: [{ticketId:"type",quantity:1,pricePerUnit:1000}] },
    { _id: "free", buyer: "free-buyer", paymentStatus: "COMPLETED", totalAmount: 0 },
    { _id: "refunded", buyer: "refunded-buyer", paymentStatus: "REFUNDED", totalAmount: 1000 },
  ];
  const controller = load("../controllers/client/eventLifecycle.controller", {
    mongoose: { Types: { ObjectId: { isValid: () => true } }, connection: { transaction: (fn) => fn({}) } },
    "../../models/client/event.schema": { findById: () => query(event) },
    "../../models/client/eventBooking.schema": { find: (filter) => query(
      typeof filter.paymentStatus === "string" ? bookings.filter(b => b.paymentStatus === filter.paymentStatus) : bookings) },
    "../../models/client/userEventTicket.schema": {
      countDocuments: async (filter) => { countFilter = filter; return 2; },
      updateMany: async () => ({}), find: () => query([{ _id: "ticket", bookingId: "paid", ticketTypeId: "type", owner: "holder" }]),
      distinct: () => query(["holder", "buyer"]),
    },
    "../../models/client/ticketTransferRequest.schema": { updateMany: async () => ({}) },
    "../../models/client/eventRefund.schema": { insertMany: async (docs) => { refunds = docs; } },
    "../../constants/notificationTypes": constants,
    "../../services/ticketRefundAllocation.service": require("../services/ticketRefundAllocation.service"),
    "../../services/eventRefundAmount.service": require("../services/eventRefundAmount.service"),
    "../../services/refundNotifications.service": {
      cancellationNotices: (event, recipients) => ({ recipients, message: `${event.title} ${event.lifecycle.cancellationMessage}` }),
      queueNotices: async payload => { sent = payload; if (failDelivery) throw new Error("Outbox unavailable"); },
    },
  });
  return { event, get sent() { return sent; }, get refunds() { return refunds; }, get countFilter() { return countFilter; },
    async call(method, body = { message: "Venue unavailable", confirm: true }) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await controller[method]({ params: { id: "event" }, user: { id: owner }, body }, res);
      return res;
    } };
}
test("preview reports ticket-price liability and excludes redeemed/cancelled tickets", async () => {
  const f = lifecycle(); const res = await f.call("cancellationPreview");
  assert.equal(res.body.data.paidOrders, 1);
  assert.equal(res.body.data.refundLiabilityMinorByCurrency.NGN, 1000);
  assert.deepEqual(Array.from(f.countFilter.status.$nin), ["CANCELLED", "REDEEMED"]);
});
test("cancellation notifies every buyer and holder once, refunds only completed paid bookings", async () => {
  const f = lifecycle(); const res = await f.call("cancelEvent");
  assert.equal(res.code, 200);
  assert.equal(f.event.status, "CANCELLED");
  assert.deepEqual(Array.from(f.sent.recipients).sort(), ["buyer", "free-buyer", "holder", "refunded-buyer"]);

  assert.match(f.sent.message, /Concert.*Venue unavailable/);
  assert.equal(f.refunds.length, 1);
  assert.equal(f.refunds[0].amountMinor, 1000);
  assert.equal(f.refunds[0].buyer, "holder");
  assert.equal(f.refunds[0].ticketId, "ticket");
  assert.equal(res.body.data.notifications.queued, 4);
});
test("outbox failure rejects cancellation so the database transaction can roll back", async () => {
  const f = lifecycle({ failDelivery: true }); const res = await f.call("cancelEvent");
  assert.equal(res.code, 500);
});
test("unauthorized and malformed cancellation requests do not notify buyers", async () => {
  const denied = lifecycle({ owner: "other" });
  assert.equal((await denied.call("cancelEvent")).code, 403);
  assert.equal(denied.sent, undefined);
  for (const message of [" ", {}, "x".repeat(1001)]) {
    const f = lifecycle();
    assert.equal((await f.call("cancelEvent", { message, confirm: true })).code, 400);
    assert.equal(f.sent, undefined);
  }
});
function notifications(emailResult) {
  let emails = 0, docs;
  const service = load("../services/notification/notification.service", {
    "../../models/client/notification.schema": { insertMany: async (items) => { docs = items; return items; } },
    "../../models/client/user.schema": { find: () => query([{ _id: "buyer", email: "buyer@example.test",
      notificationPreferences: { channels: { email: false }, categories: { tickets: false } } }]) },
    "./push.service": { sendPushNotifications: async () => ({ successCount: 0 }) },
    "../email.service": { sendEmail: async () => { emails++; return emailResult; } },
    "./emailTemplates": { generalNotificationTemplate: () => "<p>Cancellation</p>" },
    "../../constants/notificationTypes": constants,
  });
  return { get emails() { return emails; }, get docs() { return docs; },
    send: () => service.dispatchBulkNotifications({ recipients: ["buyer"], type: constants.NOTIFICATION_TYPES.EVENT_CANCELLED,
      title: "Cancelled", message: "Cancelled", channels: ["in_app", "email"] }) };
}
test("transactional cancellation sends in-app and email despite optional email preferences", async () => {
  const f = notifications({ id: "provider-id" }); const result = await f.send();
  assert.equal(f.docs.length, 1); assert.equal(f.emails, 1); assert.equal(result.emailCount, 1);
});
test("unconfigured email delivery is not counted as sent", async () => {
  const f = notifications(null); const result = await f.send();
  assert.equal(result.inAppCount, 1); assert.equal(result.emailCount, 0);
});
test("cancellation email escapes organiser text", () => {
  const { generalNotificationTemplate } = require("../services/notification/emailTemplates");
  const html = generalNotificationTemplate({ title: "<script>bad</script>", message: "<b>Reason</b>", recipientName: "<img>" });
  assert.ok(html.includes("&lt;b&gt;Reason&lt;/b&gt;"));
  assert.ok(html.includes("&lt;img&gt;"));
  assert.ok(!html.includes("<script>"));
});
