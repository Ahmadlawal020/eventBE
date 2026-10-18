process.env.QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || "test_secret_key_for_testing_purposes_12345";
const test = require("node:test");
const assert = require("node:assert/strict");
const { uncheckInTicket } = require("../controllers/client/userEventTicket.controller");

const UserEventTicket = require("../models/client/userEventTicket.schema");
const Event = require("../models/client/event.schema");
const CoOrganiserInvitation = require("../models/client/coOrganiserInvitation.schema");
const StaffInvitation = require("../models/client/staffInvitation.schema");

test.beforeEach(t => {
  t.mock.method(require("mongoose").connection, "transaction", fn => fn({}));
  t.mock.method(Event, "findOneAndUpdate", async () => ({ status: "LISTED" }));
});

test("uncheckInTicket successfully reverts a REDEEMED ticket back to UNREDEEMED", async (t) => {
  const eventId = "507f1f77bcf86cd799439011";
  const ownerId = "507f1f77bcf86cd799439012";
  const ticketNumber = "TKT-123456";

  const originalTicket = {
    ticketNumber,
    eventId,
    status: "REDEEMED",
    redeemedAt: new Date("2030-05-01T10:00:00Z"),
    redeemedBy: ownerId,
    checkIn: {
      isCheckedIn: true,
      checkedInAt: new Date("2030-05-01T10:00:00Z"),
      checkedInBy: ownerId,
    },
    ticketName: "General Admission",
  };

  t.mock.method(UserEventTicket, "findOne", () => ({
    select: () => ({
      lean: async () => ({ eventId, status: "REDEEMED" }),
    }),
  }));

  t.mock.method(Event, "findById", () => ({
    select: () => ({
      lean: async () => ({ createdBy: ownerId }),
    }),
  }));

  let updatedStatus = null;
  t.mock.method(UserEventTicket, "findOneAndUpdate", (query, update) => {
    assert.equal(query.ticketNumber, ticketNumber);
    assert.equal(query.status, "REDEEMED");
    assert.equal(update.$set.status, "UNREDEEMED");
    assert.equal(update.$set["checkIn.isCheckedIn"], false);
    assert.ok(update.$unset.redeemedAt);
    assert.ok(update.$unset["checkIn.checkedInAt"]);

    updatedStatus = "UNREDEEMED";
    return {
      populate: async () => ({
        ticketNumber,
        ticketName: "General Admission",
        status: updatedStatus,
        owner: { firstName: "Ahmad", surname: "Test", email: "test@example.com" },
      }),
    };
  });

  const req = {
    body: { ticketNumber },
    user: { id: ownerId },
  };

  let statusCode = null;
  let responseData = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          responseData = data;
        },
      };
    },
  };

  await uncheckInTicket(req, res);

  assert.equal(statusCode, 200);
  assert.equal(responseData.success, true);
  assert.equal(responseData.data.status, "UNREDEEMED");
  assert.match(responseData.message, /reverted successfully/i);
});

test("uncheckInTicket returns 400 if ticket is not currently REDEEMED", async (t) => {
  const eventId = "507f1f77bcf86cd799439011";
  const ownerId = "507f1f77bcf86cd799439012";
  const ticketNumber = "TKT-654321";

  t.mock.method(UserEventTicket, "findOne", () => ({
    select: () => ({
      lean: async () => ({ eventId, status: "UNREDEEMED" }),
    }),
  }));

  t.mock.method(Event, "findById", () => ({
    select: () => ({
      lean: async () => ({ createdBy: ownerId }),
    }),
  }));

  const req = {
    body: { ticketNumber },
    user: { id: ownerId },
  };

  let statusCode = null;
  let responseData = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          responseData = data;
        },
      };
    },
  };

  await uncheckInTicket(req, res);

  assert.equal(statusCode, 400);
  assert.equal(responseData.success, false);
  assert.match(responseData.message, /Cannot revert check-in/);
});

test("uncheckInTicket returns 404 if ticket does not exist", async (t) => {
  t.mock.method(UserEventTicket, "findOne", () => ({
    select: () => ({
      lean: async () => null,
    }),
  }));

  const req = {
    body: { ticketNumber: "TKT-NONEXISTENT" },
    user: { id: "507f1f77bcf86cd799439012" },
  };

  let statusCode = null;
  let responseData = null;
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          responseData = data;
        },
      };
    },
  };

  await uncheckInTicket(req, res);

  assert.equal(statusCode, 404);
  assert.equal(responseData.success, false);
  assert.match(responseData.message, /Ticket not found/);
});

test("cancelled event check-ins cannot be undone", async (t) => {
  t.mock.method(UserEventTicket, "findOne", () => ({
    select: () => ({ lean: async () => ({ eventId: "event", status: "REDEEMED" }) }),
  }));
  t.mock.method(Event, "findById", () => ({
    select: () => ({ lean: async () => ({ createdBy: "owner", status: "CANCELLED" }) }),
  }));
  const write = t.mock.method(UserEventTicket, "findOneAndUpdate", () => {
    throw new Error("Cancelled tickets must not be reactivated");
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await uncheckInTicket({ body: { ticketNumber: "TKT-CANCELLED" }, user: { id: "owner" } }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.message, /cancelled/);
  assert.equal(write.mock.callCount(), 0);
});
