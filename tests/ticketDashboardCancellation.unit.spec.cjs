const test = require("node:test");
const assert = require("node:assert/strict");
const { getEventAttendees } = require("../controllers/client/ticketDashboard.controller");
const Event = require("../models/client/event.schema");
const Ticket = require("../models/client/userEventTicket.schema");
const Refund = require("../models/client/eventRefund.schema");

function query(data) {
  return { select() { return this; }, populate() { return this; }, sort() { return this; }, lean: async () => data };
}
for (const owner of [true, false]) {
  test(owner ? "owner sees cancelled tickets and booking refund status" : "staff sees cancellation state without private refund data", async (t) => {
    t.mock.method(Event, "findOne", () => query({ _id: "event", title: "Concert", status: "CANCELLED", createdBy: "owner" }));
    let filter;
    t.mock.method(Ticket, "find", value => { filter = value; return query([{ _id: "ticket", bookingId: "booking", status: "CANCELLED" }]); });
    const refunds = t.mock.method(Refund, "find", () => query([{ _id: "refund", ticketId: "ticket", status: "MARKED_PAID" }]));
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await getEventAttendees({ params: { eventId: "event" }, query: { status: "BOUGHT", tier: "VIP" }, user: { id: owner ? "owner" : "staff" } }, res);
    assert.equal(res.code, 200);
    assert.equal(filter.ticketName, "VIP");
    assert.deepEqual(filter.status.$in, ["UNREDEEMED", "REDEEMED", "CANCELLED"]);
    assert.equal(res.body.event.status, "CANCELLED");
    assert.equal(res.body.event.canManageRefunds, owner);
    if (owner) {
      assert.deepEqual(res.body.data[0].refund, { id: "refund", status: "MARKED_PAID" });
    } else {
      assert.equal(res.body.data[0].refund, undefined);
      assert.equal(refunds.mock.callCount(), 0);
    }
  });
}
test("cancelled-only guest filter remains exact", async (t) => {
  t.mock.method(Event, "findOne", () => query({ _id: "event", createdBy: "owner" }));
  let filter;
  t.mock.method(Ticket, "find", value => { filter = value; return query([]); });
  t.mock.method(Refund, "find", () => query([]));
  const res = { status() { return this; }, json() {} };
  await getEventAttendees({ params: { eventId: "event" }, query: { status: "CANCELLED" }, user: { id: "owner" } }, res);
  assert.equal(filter.status, "CANCELLED");
});
