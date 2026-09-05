const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const { generateAdminAuthToken } = require("./setup");

describe("Admin event overview API", () => {
  let token;
  let topEvent;

  beforeEach(async () => {
    const suffix = new mongoose.Types.ObjectId().toString();
    const admin = await User.create({
      firstName: "Event",
      surname: "Admin",
      email: `event.insights.${suffix}@example.com`,
      password: "Password123!",
      dob: new Date("1990-01-01"),
      roles: ["admin", "super_admin"],
    });
    token = generateAdminAuthToken(admin);

    const future = new Date();
    future.setDate(future.getDate() + 20);
    const futureEnd = new Date(future);
    futureEnd.setHours(futureEnd.getHours() + 4);
    const past = new Date();
    past.setDate(past.getDate() - 20);
    const pastEnd = new Date(past);
    pastEnd.setHours(pastEnd.getHours() + 4);

    [topEvent] = await Event.create([
      {
        title: `Lagos Product Summit ${suffix}`,
        eventType: "TECHNOLOGY_INNOVATION",
        status: "LISTED",
        schedule: { from: future, to: futureEnd },
        capacity: 600,
        performance: {
          reach: 4000,
          views: 1200,
          clicks: 360,
          wishlists: 90,
          shares: 45,
          engagement: 480,
          ticketSales: 140,
          revenue: 1400000,
        },
      },
      {
        title: `Community Workshop ${suffix}`,
        eventType: "WORKSHOPS_TRAINING",
        status: "ACTION_REQUIRED",
        schedule: { from: past, to: pastEnd },
        capacity: 80,
        performance: {
          reach: 500,
          views: 200,
          clicks: 30,
          wishlists: 10,
          shares: 5,
          engagement: 50,
          ticketSales: 8,
          revenue: 40000,
        },
      },
    ]);
  });

  it("returns platform-wide event lifecycle and performance metrics", async () => {
    const response = await request(app)
      .get("/api/admin/listings")
      .query({ type: "event", status: "LISTED", sort: "most_viewed" })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.listings).toHaveLength(1);
    expect(response.body.data.listings[0]._id).toBe(String(topEvent._id));

    const { events } = response.body.data.metrics;
    expect(events).toMatchObject({
      total: 2,
      listed: 1,
      actionRequired: 1,
      upcoming: 1,
      past: 1,
      capacity: 680,
      reach: 4500,
      views: 1400,
      clicks: 390,
      wishlists: 100,
      shares: 50,
      ticketSales: 148,
      revenue: 1440000,
    });
    expect(events.categories).toEqual(
      expect.arrayContaining([
        { _id: "TECHNOLOGY_INNOVATION", count: 1 },
        { _id: "WORKSHOPS_TRAINING", count: 1 },
      ]),
    );
  });

  it("supports promotion ranking by ticket sales and engagement", async () => {
    const salesResponse = await request(app)
      .get("/api/admin/listings")
      .query({ type: "event", sort: "most_sold" })
      .set("Authorization", `Bearer ${token}`);
    const engagementResponse = await request(app)
      .get("/api/admin/listings")
      .query({ type: "event", sort: "most_engaged" })
      .set("Authorization", `Bearer ${token}`);

    expect(salesResponse.status).toBe(200);
    expect(engagementResponse.status).toBe(200);
    expect(salesResponse.body.data.listings[0]._id).toBe(String(topEvent._id));
    expect(engagementResponse.body.data.listings[0]._id).toBe(
      String(topEvent._id),
    );
  });
});
