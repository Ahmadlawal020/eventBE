const test = require("node:test");
const assert = require("node:assert/strict");
const Event = require("../models/client/event.schema");
const Ticket = require("../models/client/eventTicketType.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const { getListings } = require("../controllers/client/listings.controller");

test("public listings exclude cancelled events and expose listing status", async (t) => {
  const events = [
    { _id: "live", title: "Live", status: "LISTED" },
    { _id: "cancelled", title: "Cancelled", status: "CANCELLED" },
    { _id: "draft", title: "Draft", status: "IN_PROGRESS" },
  ];
  t.mock.method(Event, "find", (filter) => {
    assert.equal(filter.status, "LISTED");
    return { lean: async () => events.filter(event => event.status === filter.status) };
  });
  t.mock.method(Ticket, "find", () => ({ lean: async () => [] }));
  t.mock.method(EventCenter, "find", (filter) => {
    assert.equal(filter.status, "LISTED");
    return { lean: async () => [{ _id: "venue", status: "LISTED" }] };
  });
  const res = { status() { return this; }, json(body) { this.body = body; } };
  await getListings({ query: {} }, res);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data.map(item => item.id), ["live", "venue"]);
  assert.ok(res.body.data.every(item => item.status === "LISTED"));
  events[0].status = "CANCELLED";
  await getListings({ query: {} }, res);
  assert.deepEqual(res.body.data.map(item => item.id), ["venue"]);
  assert.equal(res.body.pagination.total, 1);
});
