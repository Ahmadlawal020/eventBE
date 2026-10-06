const test = require("node:test");
const assert = require("node:assert/strict");
const { getTicketMinBasePrice } = require("../services/eventSettings.service");

test("getTicketMinBasePrice returns currency-specific minimum when defined", () => {
  const pricing = {
    minimumBasePrice: 100,
    minimumBasePrices: {
      NGN: 500,
      USD: 10,
      EUR: 8,
    },
  };

  assert.equal(getTicketMinBasePrice(pricing, "NGN"), 500);
  assert.equal(getTicketMinBasePrice(pricing, "USD"), 10);
  assert.equal(getTicketMinBasePrice(pricing, "EUR"), 8);
  assert.equal(getTicketMinBasePrice(pricing, "ngn"), 500);
});

test("getTicketMinBasePrice falls back to minimumBasePrice if currency not in minimumBasePrices", () => {
  const pricing = {
    minimumBasePrice: 50,
    minimumBasePrices: {
      NGN: 500,
    },
  };

  assert.equal(getTicketMinBasePrice(pricing, "GBP"), 50);
});

test("getTicketMinBasePrice returns 0 when pricing or values are absent", () => {
  assert.equal(getTicketMinBasePrice(undefined, "NGN"), 0);
  assert.equal(getTicketMinBasePrice({}, "NGN"), 0);
  assert.equal(getTicketMinBasePrice({ minimumBasePrice: 0 }, "NGN"), 0);
});
