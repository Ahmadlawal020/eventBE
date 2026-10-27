const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
test("venue payment history scopes list and count to buyer and includes failed refunds in review", async () => {
  const calls = {};
  const chain = {};
  for (const method of ["populate", "select", "sort", "skip", "limit"]) chain[method] = value => { calls[method] = value; return chain; };
  chain.lean = async () => [{ _id: "venue-payment", paymentResolutionRequired: true }];
  const model = { find: filter => { calls.find = filter; return chain; }, countDocuments: async filter => { calls.count = filter; return 1; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../controllers/client/eventCenterTicket.controller.js"), "utf8"), {
    module, require(name) {
      if (name.endsWith("eventCenterBooking.schema")) return model;
      if (name === "../../services/payment") return { getPaymentGateway: () => ({}) };
      return {};
    },
  });
  const handler = module.exports.getMyTickets;
  let body;
  const response = { json: value => { body = value; }, status: () => response };
  await handler({ user: { id: "buyer-1" }, query: { needsAttention: "true", page: "2", limit: "10" } }, response);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find)), { buyer: "buyer-1", $or: [{ paymentResolutionRequired: true }, { paymentStatus: "FAILED_REFUND" }] });
  assert.equal(calls.find, calls.count);
  assert.match(calls.select, /paymentResolutionRequired/);
  assert.equal(calls.skip, 10);
  assert.equal(body.pagination.total, 1);
  await handler({ user: { id: "buyer-2" }, query: {} }, response);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find)), { buyer: "buyer-2" });
});
