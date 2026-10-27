process.env.NODE_ENV = "test";
process.env.QR_SIGNING_SECRET = "event-readiness-test-only";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertEntryOpen,
  eventEnd,
  isEntryClosed,
} = require("../services/eventEntry.service");
const {
  validateEventOrderItems,
  assertTierOrderLimit,
} = require("../services/eventOrderValidation.service");
const { prepareListingPatch } = require("../utils/listingPatch");
const Ticket = require("../models/client/eventTicketType.schema");
const product = "507f1f77bcf86cd799439011";
test("entry closes at event end, for completed/cancelled events and missing schedules", () => {
  const now = new Date("2030-01-01T12:00:00Z").getTime();
  for (const status of [
    "CANCELLED",
    "COMPLETED",
    "IN_PROGRESS",
    "ACTION_REQUIRED",
  ])
    assert.throws(() =>
      assertEntryOpen(
        { status, schedule: { to: new Date(now + 3600000) } },
        now,
      ),
    );
  for (const status of ["LISTED", "UNLISTED"])
    assert.doesNotThrow(() =>
      assertEntryOpen(
        { status, schedule: { to: new Date(now + 3600000) } },
        now,
      ),
    );
  assert.throws(() =>
    assertEntryOpen({ status: "LISTED", schedule: { to: new Date(now) } }, now),
  );
  assert.throws(() => assertEntryOpen({ status: "LISTED" }, now));
  assert.equal(isEntryClosed({ status: "LISTED" }, now), true);
  assert.equal(
    isEntryClosed(
      { status: "LISTED", schedule: { to: new Date(now + 1) } },
      now,
    ),
    false,
  );
  assert.equal(
    eventEnd({ schedule: { from: "2030-01-01T12:00:00Z" } }),
    now + 86400000,
  );
});
test("event order validation rejects duplicate tiers, malformed IDs, fractional and excessive quantities", () => {
  assert.equal(validateEventOrderItems([{ product, quantity: 2 }], 10), 2);
  for (const items of [
    [
      { product, quantity: 1 },
      { product, quantity: 1 },
    ],
    [{ product: "invalid", quantity: 1 }],
    [{ product, quantity: 1.5 }],
    [{ product, quantity: 0 }],
    [{ product, quantity: 11 }],
  ])
    assert.throws(() => validateEventOrderItems(items, 10));
  assert.throws(() =>
    assertTierOrderLimit(
      { name: "VIP", perTransactionLimit: { min: 2, max: 3 } },
      1,
    ),
  );
  assert.throws(() =>
    assertTierOrderLimit(
      { name: "VIP", perTransactionLimit: { min: 2, max: 3 } },
      4,
    ),
  );
});
test("protected ticket fields and operator payloads cannot enter an editable patch", () => {
  const fields = new Set(["name", "price", "totalQuantity"]);
  for (const payload of [
    { soldQuantity: 0 },
    { eventId: product },
    { $set: { name: "bad" } },
    { "price.amountCents": 1 },
  ])
    assert.throws(() => prepareListingPatch(payload, fields, {}));
  assert.deepEqual(
    prepareListingPatch({ price: { amountCents: 100 } }, fields, {}),
    { price: { amountCents: 100 } },
  );
});
test("ticket inventory and prices reject negative and fractional values at the model boundary", () => {
  for (const [field, value] of [
    ["totalQuantity", 1.5],
    ["soldQuantity", -1],
    ["perTransactionLimit.max", 0],
    ["price.amountCents", 10.1],
  ]) {
    const ticket = new Ticket();
    ticket.set(field, value);
    assert.ok(ticket.validateSync()?.errors[field], field);
  }
});
