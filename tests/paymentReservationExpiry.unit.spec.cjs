process.env.NODE_ENV = "test";
process.env.QR_SIGNING_SECRET = "reservation-test-only";
const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Booking = require("../models/client/eventBooking.schema");
const gateway = require("../services/payment");
const safety = require("../services/checkoutSafety.service");
afterEach(() => mock.restoreAll());
function fixture(paymentOrError, attempts = 0) {
  const booking = {
    _id: "booking-test",
    paymentReference: "test-only",
    reservationReconciliation: { attempts },
  };
  let filter, update, sort;
  mock.method(Booking, "find", (value) => {
    filter = value;
    return {
      sort(value) {
        sort = value;
        return this;
      },
      limit: async () => [booking],
    };
  });
  mock.method(Booking, "updateOne", async (query, value) => {
    update = { query, value };
  });
  mock.method(gateway, "getPaymentGateway", () => ({
    verifyPayment: async () => {
      if (paymentOrError instanceof Error) throw paymentOrError;
      return paymentOrError;
    },
  }));
  const expire = mock.method(safety, "expireEventReservation", async () => {});
  mock.method(console, "error", () => {});
  delete require.cache[require.resolve("../jobs/paymentReservationExpiry.job")];
  return {
    run: require("../jobs/paymentReservationExpiry.job").expireReservations,
    expire,
    get filter() {
      return filter;
    },
    get update() {
      return update;
    },
    get sort() {
      return sort;
    },
  };
}
test("generic provider 400 defers verification without releasing inventory", async () => {
  const f = fixture(
    Object.assign(new Error("400"), {
      response: { status: 400, data: { message: "Invalid key" } },
    }),
  );
  await f.run();
  assert.equal(f.expire.mock.callCount(), 0);
  assert.equal(f.update.query.paymentStatus, "PENDING");
  assert.equal(f.update.value.$inc["reservationReconciliation.attempts"], 1);
  const fields = f.update.value.$set;
  assert.equal(
    fields["reservationReconciliation.nextAttemptAt"] -
      fields["reservationReconciliation.lastCheckedAt"],
    300000,
  );
  assert.ok(
    f.filter.$or.some(
      (item) => item["reservationReconciliation.nextAttemptAt"]?.$lte,
    ),
  );
  assert.equal(f.sort["reservationReconciliation.lastCheckedAt"], 1);
});
test("network errors back off to one hour and keep uncertain reservations", async () => {
  const f = fixture(new Error("network timeout"), 12);
  await f.run();
  const fields = f.update.value.$set;
  assert.equal(
    fields["reservationReconciliation.nextAttemptAt"] -
      fields["reservationReconciliation.lastCheckedAt"],
    3600000,
  );
  assert.equal(f.expire.mock.callCount(), 0);
});
test("only explicit missing transactions expire on HTTP 400 or 404", async () => {
  for (const status of [400, 404]) {
    const f = fixture(
      Object.assign(new Error("missing"), {
        response: {
          status,
          data: { message: "Transaction reference not found" },
        },
      }),
    );
    await f.run();
    assert.equal(f.expire.mock.callCount(), 1);
    assert.equal(f.update, undefined);
    mock.restoreAll();
  }
  const f = fixture(
    Object.assign(new Error("bad endpoint"), { response: { status: 404 } }),
  );
  await f.run();
  assert.equal(f.expire.mock.callCount(), 0);
  assert.ok(f.update);
});
test("unknown provider statuses are deferred instead of retried without delay", async () => {
  const f = fixture({ status: "unknown" });
  await f.run();
  assert.equal(f.expire.mock.callCount(), 0);
  assert.ok(f.update);
});
