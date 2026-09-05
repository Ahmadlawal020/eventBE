const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const Ticket = require("../models/client/eventTicketType.schema");
const UserEventTicket = require("../models/client/userEventTicket.schema");
const { generateAdminAuthToken } = require("./setup");

describe("Admin ticket operations API", () => {
  let admin;
  let adminToken;
  let event;
  let tier;
  let uniqueSuffix;

  beforeEach(async () => {
    uniqueSuffix = new mongoose.Types.ObjectId().toString();
    admin = await User.create({
      firstName: "Ticket",
      surname: "Admin",
      email: `ticket.admin.${uniqueSuffix}@example.com`,
      password: "Password123!",
      dob: new Date("1990-01-01"),
      roles: ["admin", "super_admin"],
    });
    adminToken = generateAdminAuthToken(admin);
    event = await Event.create({
      title: `Lagos Operations Summit ${uniqueSuffix}`,
      eventType: "BUSINESS_NETWORKING",
      createdBy: admin._id,
      status: "LISTED",
      schedule: {
        from: new Date(Date.now() + 86400000),
        to: new Date(Date.now() + 172800000),
      },
    });
    tier = await Ticket.create({
      eventId: event._id,
      name: "Executive access",
      ticketType: "PAID",
      totalQuantity: 100,
      soldQuantity: 20,
      salesStartAt: new Date(Date.now() - 86400000),
      salesEndAt: new Date(Date.now() + 43200000),
      currency: { code: "NGN", symbol: "₦" },
      commission: { percentage: 5, type: "DEDUCT_FROM_PRICE" },
      price: { amountCents: 2500000 },
    });
    await Ticket.create({
      eventId: event._id,
      name: "Community access",
      ticketType: "FREE",
      totalQuantity: 50,
      soldQuantity: 4,
      salesStartAt: new Date(Date.now() - 86400000),
      salesEndAt: new Date(Date.now() + 43200000),
      currency: { code: "NGN", symbol: "₦" },
      commission: { percentage: 0, type: "DEDUCT_FROM_PRICE" },
    });
  });

  it("supports event search, issued pagination, and protected ticket details", async () => {
    const ticketData = {
      bookingId: new mongoose.Types.ObjectId(),
      eventId: event._id,
      ticketTypeId: tier._id,
      owner: admin._id,
      ticketName: "Executive access",
      eventSnapshot: {
        title: event.title,
        schedule: {
          startDate: event.schedule.from,
          endDate: event.schedule.to,
        },
      },
      ticketSnapshot: {
        name: "Executive access",
        ticketType: "PAID",
      },
    };
    const firstIssued = await UserEventTicket.create({
      ...ticketData,
      ticketNumber: `MUNA-FIRST-${uniqueSuffix}`,
      qrPayload: "signed-first-payload",
    });
    const secondIssued = await UserEventTicket.create({
      ...ticketData,
      ticketNumber: `MUNA-SECOND-${uniqueSuffix}`,
      qrPayload: "signed-second-payload",
    });

    const searchResponse = await request(app)
      .get("/api/admin/tickets")
      .query({ search: uniqueSuffix, view: "ticket-types" })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.data.ticketTypes).toHaveLength(2);
    expect(
      searchResponse.body.data.metrics.totalCapacity,
    ).toBeGreaterThanOrEqual(150);
    expect(searchResponse.body.data.metrics.soldTickets).toBeGreaterThanOrEqual(
      24,
    );

    const firstPage = await request(app)
      .get("/api/admin/tickets")
      .query({
        view: "issued-tickets",
        search: uniqueSuffix,
        page: 1,
        limit: 1,
      })
      .set("Authorization", `Bearer ${adminToken}`);
    const secondPage = await request(app)
      .get("/api/admin/tickets")
      .query({
        view: "issued-tickets",
        search: uniqueSuffix,
        page: 2,
        limit: 1,
      })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(firstPage.status).toBe(200);
    expect(secondPage.status).toBe(200);
    expect(firstPage.body.data.pagination.total).toBe(2);
    expect(firstPage.body.data.issuedTickets).toHaveLength(1);
    expect(secondPage.body.data.issuedTickets).toHaveLength(1);
    expect(firstPage.body.data.issuedTickets[0]._id).not.toBe(
      secondPage.body.data.issuedTickets[0]._id,
    );

    const detailResponse = await request(app)
      .get(`/api/admin/tickets/${firstIssued._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.ticketType).toBe("issued-ticket");
    expect(detailResponse.body.data.ticket.hasQrPayload).toBe(true);
    expect(detailResponse.body.data.ticket.qrPayload).toBeUndefined();
    expect([String(firstIssued._id), String(secondIssued._id)]).toContain(
      firstPage.body.data.issuedTickets[0]._id,
    );
  });
});
