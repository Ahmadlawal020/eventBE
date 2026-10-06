const test = require("node:test");
const assert = require("node:assert/strict");
const { salesEndError, salesWindowError, realignTicketSalesWindows } = require("../services/ticketSalesWindow.service");

const event = { schedule: { from: "2030-04-01T09:00:00Z", to: "2030-04-03T18:00:00Z" } };

test("realignTicketSalesWindows clamps only tickets whose salesEndAt exceeds the new event end", async () => {
  const mockTickets = [
    {
      _id: "t1",
      eventId: "e1",
      name: "Early Bird",
      salesStartAt: new Date("2030-03-01T10:00:00Z"),
      salesEndAt: new Date("2030-03-25T18:00:00Z"), // well before new event end, should not be touched
    },
    {
      _id: "t2",
      eventId: "e1",
      name: "Standard",
      salesStartAt: new Date("2030-03-01T10:00:00Z"),
      salesEndAt: new Date("2030-04-03T18:00:00Z"), // exceeds new end of April 2nd, must be clamped
    },
    {
      _id: "t3",
      eventId: "e1",
      name: "VIP",
      salesStartAt: new Date("2030-03-01T10:00:00Z"),
      salesEndAt: new Date("2030-04-05T18:00:00Z"), // exceeds new end of April 2nd, must be clamped
    },
  ];

  let updateManyCalls = [];
  const mockTicketModel = {
    find: async ({ eventId, salesEndAt }) => {
      const gtDate = salesEndAt.$gt;
      return mockTickets.filter(
        (t) => t.eventId === eventId && t.salesEndAt.getTime() > gtDate.getTime()
      );
    },
    updateMany: async (filter, update) => {
      updateManyCalls.push({ filter, update });
      return { modifiedCount: 2 };
    },
  };

  const newEventEnd = "2030-04-02T18:00:00Z";
  const adjustedCount = await realignTicketSalesWindows("e1", newEventEnd, mockTicketModel);

  assert.equal(adjustedCount, 2);
  assert.equal(updateManyCalls.length, 2); // 1 for salesEndAt, 1 for salesStartAt
  assert.deepEqual(updateManyCalls[0].update, {
    $set: { salesEndAt: new Date(newEventEnd) },
  });
});

test("realignTicketSalesWindows returns 0 and does not update when no tickets exceed new end", async () => {
  let updateManyCalled = false;
  const mockTicketModel = {
    find: async () => [],
    updateMany: async () => {
      updateManyCalled = true;
    },
  };

  const adjustedCount = await realignTicketSalesWindows("e1", "2030-05-01T00:00:00Z", mockTicketModel);
  assert.equal(adjustedCount, 0);
  assert.equal(updateManyCalled, false);
});


test("organisers can start selling tickets well before the event starts", () => {
  // Sales start 2 weeks before event starts, ends at event conclusion
  assert.equal(
    salesWindowError(event, "2030-03-15T09:00:00Z", "2030-04-03T18:00:00Z"),
    null
  );
  // Sales start 1 day before event starts, ends during the event
  assert.equal(
    salesWindowError(event, "2030-03-31T12:00:00Z", "2030-04-02T12:00:00Z"),
    null
  );
});

test("ticket sales can continue during a multi-day event until event ends", () => {
  assert.equal(salesEndError(event, "2030-04-02T12:00:00Z"), null);
  assert.equal(salesEndError(event, event.schedule.to), null);
});

test("ticket sales end cannot outlast the final event date", () => {
  assert.match(salesEndError(event, "2030-04-03T18:00:01Z"), /event end/);
  assert.match(
    salesWindowError(event, "2030-03-15T09:00:00Z", "2030-04-03T18:00:01Z"),
    /event end/
  );
});

test("ticket sales end cannot be on or before ticket sales start", () => {
  assert.match(
    salesWindowError(event, "2030-03-20T10:00:00Z", "2030-03-20T10:00:00Z"),
    /after the start date/
  );
  assert.match(
    salesWindowError(event, "2030-03-20T10:00:00Z", "2030-03-19T10:00:00Z"),
    /after the start date/
  );
});

test("ticket sales cannot start after the event has already ended", () => {
  assert.match(
    salesWindowError(event, "2030-04-04T09:00:00Z", "2030-04-05T09:00:00Z"),
    /cannot start after the event has ended/
  );
});

test("organisers can end sales earlier than the event end", () => {
  assert.equal(salesEndError(event, "2030-03-31T12:00:00Z"), null);
});

test("single-day events can sell tickets before start and until their end time", () => {
  const singleDay = { schedule: { from: "2030-04-01T09:00:00Z", to: "2030-04-01T18:00:00Z" } };
  assert.equal(
    salesWindowError(singleDay, "2030-03-25T00:00:00Z", "2030-04-01T18:00:00Z"),
    null
  );
});

test("invalid sales dates return an actionable error", () => {
  assert.match(salesEndError(event, "invalid"), /valid ticket sales end/);
  assert.match(
    salesWindowError(event, "invalid", "2030-04-03T18:00:00Z"),
    /valid ticket sales start/
  );
});
