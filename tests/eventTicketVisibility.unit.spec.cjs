process.env.NODE_ENV = "test";
const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Event = require("../models/client/event.schema");
const Ticket = require("../models/client/eventTicketType.schema");
const {
  getTickets,
  getTicketById,
} = require("../controllers/client/eventTicketType.controller");
const eventId = "507f1f77bcf86cd799439011";
const owner = "507f1f77bcf86cd799439012";
const response = () => ({
  code: 200,
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});
const query = (value) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});
afterEach(() => mock.restoreAll());
test("ticket lists require an event ID instead of exposing every event's tiers", async () => {
  mock.method(Ticket, "find", () => assert.fail("must not query tiers"));
  const res = response();
  await getTickets({ query: {} }, res);
  assert.equal(res.code, 400);
});
test("public callers cannot read draft or cancelled event tiers", async () => {
  for (const status of ["IN_PROGRESS", "CANCELLED", "COMPLETED", "UNLISTED"]) {
    mock.method(Event, "findById", () =>
      query({ _id: eventId, status, createdBy: owner }),
    );
    mock.method(Ticket, "find", () =>
      assert.fail("must not query private tiers"),
    );
    const res = response();
    await getTickets({ query: { eventId } }, res);
    assert.equal(res.code, 404);
    mock.restoreAll();
  }
});
test("listed events are public and organisers can read their own draft tiers", async () => {
  for (const [status, user] of [
    ["LISTED", undefined],
    ["IN_PROGRESS", { id: owner }],
  ]) {
    mock.method(Event, "findById", () =>
      query({ _id: eventId, status, createdBy: owner }),
    );
    mock.method(Ticket, "find", (filter) => {
      assert.deepEqual(filter, { eventId });
      return query([{ name: "Standard" }]);
    });
    const res = response();
    await getTickets({ query: { eventId }, user }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.data.length, 1);
    mock.restoreAll();
  }
});
test("a direct tier ID cannot bypass event visibility", async () => {
  mock.method(Ticket, "findById", () =>
    query({
      eventId: { _id: eventId, status: "IN_PROGRESS", createdBy: owner },
    }),
  );
  const res = response();
  await getTicketById({ params: { id: eventId } }, res);
  assert.equal(res.code, 404);
});
