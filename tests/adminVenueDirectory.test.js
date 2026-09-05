const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const { generateAdminAuthToken } = require("./setup");

describe("Admin venue directory API", () => {
  let token;
  let owner;
  let conventionCenter;
  let suffix;

  beforeEach(async () => {
    suffix = new mongoose.Types.ObjectId().toString();
    const [admin, createdOwner] = await User.create([
      {
        firstName: "Venue",
        surname: "Admin",
        email: `venue.admin.${suffix}@example.com`,
        password: "Password123!",
        dob: new Date("1990-01-01"),
        roles: ["admin", "super_admin"],
      },
      {
        firstName: "Amina",
        surname: `Host ${suffix}`,
        email: `venue.owner.${suffix}@example.com`,
        password: "Password123!",
        dob: new Date("1990-01-01"),
      },
    ]);
    token = generateAdminAuthToken(admin);
    owner = createdOwner;

    conventionCenter = await EventCenter.create({
      venueName: `Harbour Convention Centre ${suffix}`,
      venueType: "CONVENTION_CENTER",
      shortDescription: "Flexible waterfront venue for large productions.",
      createdBy: owner._id,
      status: "LISTED",
      location: { city: "Lagos", country: "Nigeria" },
      capacity: { max: 500 },
      basePrice: { amount: 750000, currency: "NGN", unit: "day" },
      bookingSettings: "REVIEW",
      amenities: ["PARKING", "WIFI"],
      performance: { views: 1200, bookings: 14 },
    });
    await EventCenter.create({
      venueName: `Garden Hall ${suffix}`,
      venueType: "BANQUET_HALL",
      createdBy: owner._id,
      status: "ACTION_REQUIRED",
      location: { city: "Abuja", country: "Nigeria" },
      capacity: { max: 150 },
      performance: { views: 80, bookings: 2 },
    });
  });

  it("filters venues and returns platform-wide venue metrics", async () => {
    const response = await request(app)
      .get("/api/admin/listings")
      .query({
        type: "event-center",
        venueType: "CONVENTION_CENTER",
        search: owner.email,
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.listings).toHaveLength(1);
    expect(response.body.data.listings[0]._id).toBe(
      String(conventionCenter._id),
    );
    expect(response.body.data.listings[0].createdBy.email).toBe(owner.email);
    expect(
      response.body.data.metrics.eventCenters.total,
    ).toBeGreaterThanOrEqual(2);
    expect(
      response.body.data.metrics.eventCenters.listed,
    ).toBeGreaterThanOrEqual(1);
    expect(
      response.body.data.metrics.eventCenters.actionRequired,
    ).toBeGreaterThanOrEqual(1);
    expect(
      response.body.data.metrics.eventCenters.totalCapacity,
    ).toBeGreaterThanOrEqual(650);
  });

  it("returns complete venue details and audits status changes", async () => {
    const detailResponse = await request(app)
      .get(`/api/admin/listings/event-center/${conventionCenter._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.listing.venueName).toBe(
      conventionCenter.venueName,
    );
    expect(detailResponse.body.data.listing.basePrice.amount).toBe(750000);
    expect(detailResponse.body.data.listing.createdBy.email).toBe(owner.email);

    const updateResponse = await request(app)
      .patch(`/api/admin/listings/event-center/${conventionCenter._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "UNLISTED", reason: "Temporary host request" });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.status).toBe("UNLISTED");
    expect((await EventCenter.findById(conventionCenter._id)).status).toBe(
      "UNLISTED",
    );

    const invalidResponse = await request(app)
      .get("/api/admin/listings/event-center/not-an-object-id")
      .set("Authorization", `Bearer ${token}`);
    expect(invalidResponse.status).toBe(400);
  });
});
