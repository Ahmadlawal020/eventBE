const request = require("supertest");
const app = require("../app");
const User = require("../models/user/user.schema");
const Event = require("../models/user/event.schema");
const EventTicketType = require("../models/user/eventTicketType.schema");
const { generateAuthToken } = require("./setup");

describe("Events & Ticket Types API", () => {
  let user;
  let token;

  beforeEach(async () => {
    user = await User.create({
      firstName: "Organiser",
      surname: "User",
      email: "organiser@example.com",
      password: "Password123!",
      dob: new Date("1992-01-01"),
      roles: ["user", "organiser"],
    });
    token = generateAuthToken(user);
  });

  it("should create an event successfully", async () => {
    const eventPayload = {
      title: "Lagos Tech Fest 2026",
      description: "Annual gathering of tech innovators",
      category: "Technology",
      schedule: {
        startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
        startTime: "09:00",
        endTime: "18:00",
      },
      location: {
        address: "Landmark Event Centre",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
      venueName: "Landmark Centre",
      status: "LISTED",
    };

    const res = await request(app)
      .post("/api/events")
      .set("Authorization", `Bearer ${token}`)
      .send(eventPayload);

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe(eventPayload.title);
  });

  it("should fetch public events list", async () => {
    await Event.create({
      title: "Public Music Fest",
      description: "A fun music night",
      category: "Concerts",
      schedule: {
        startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
        startTime: "18:00",
        endTime: "23:00",
      },
      location: { address: "Victoria Island", city: "Lagos", state: "Lagos", country: "Nigeria" },
      createdBy: user._id,
      status: "LISTED",
    });

    const res = await request(app).get("/api/events");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.events || res.body.data)).toBe(true);
  });

  it("should create and retrieve ticket tiers for an event", async () => {
    const event = await Event.create({
      title: "VIP Gala",
      description: "Exclusive gala",
      category: "Gala",
      schedule: {
        startDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      },
      createdBy: user._id,
      status: "LISTED",
    });

    const ticketPayload = {
      eventId: event._id,
      name: "VIP Admission",
      description: "Full VIP access and complimentary drinks",
      ticketType: "PAID",
      price: { amountCents: 5000000 },
      totalQuantity: 100,
      salesStartAt: new Date(),
      salesEndAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      currency: { code: "NGN", symbol: "₦" },
      commission: { percentage: 10, type: "DEDUCT_FROM_PRICE" },
    };

    const res = await request(app)
      .post("/api/event-tickets")
      .set("Authorization", `Bearer ${token}`)
      .send(ticketPayload);

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);

    const getRes = await request(app).get(`/api/event-tickets?eventId=${event._id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
  });
});
