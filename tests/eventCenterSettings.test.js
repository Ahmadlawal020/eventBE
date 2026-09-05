const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const AdminAuditLog = require("../models/management/adminAuditLog.schema");
const { generateAdminAuthToken, generateAuthToken } = require("./setup");

describe("Event center settings API", () => {
  let adminToken;
  let ownerToken;

  beforeEach(async () => {
    const [admin, owner] = await User.create([
      {
        firstName: "Venues",
        surname: "Admin",
        email: "venues.settings.admin@example.com",
        password: "Password123!",
        dob: new Date("1990-01-01"),
        roles: ["admin", "super_admin"],
      },
      {
        firstName: "Venue",
        surname: "Owner",
        email: "venue.settings.owner@example.com",
        password: "Password123!",
        dob: new Date("1990-01-01"),
        roles: ["user"],
      },
    ]);
    adminToken = generateAdminAuthToken(admin);
    ownerToken = generateAuthToken(owner);
  });

  it("persists settings and exposes enabled public venue options", async () => {
    const initial = await request(app)
      .get("/api/admin/event-center-settings")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(initial.status).toBe(200);
    expect(initial.body.data.venueTypes).toHaveLength(12);
    expect(initial.body.data.amenities).toHaveLength(12);

    const update = await request(app)
      .put("/api/admin/event-center-settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        general: { defaultCurrency: "GHS" },
        publishing: { minimumImages: 2, minimumSafetyItems: 1 },
        booking: { defaultBookingMode: "REVIEW" },
        venueTypes: [
          {
            key: "CLUB_LOUNGE",
            label: "Clubs and lounges",
            enabled: false,
            featured: false,
            sortOrder: 9,
          },
        ],
      });

    expect(update.status).toBe(200);
    expect(update.body.data.general.defaultCurrency).toBe("GHS");
    expect(update.body.data.publishing.minimumImages).toBe(2);
    expect(update.body.data.booking.defaultBookingMode).toBe("REVIEW");

    const publicResponse = await request(app).get(
      "/api/event-centers/settings",
    );
    expect(publicResponse.status).toBe(200);
    expect(
      publicResponse.body.data.venueTypes.some(
        (option) => option.key === "CLUB_LOUNGE",
      ),
    ).toBe(false);

    const audit = await AdminAuditLog.findOne({
      action: "EVENT_CENTER_SETTINGS_UPDATED",
    });
    expect(audit).not.toBeNull();
  });

  it("enforces disabled catalog options when owners create venues", async () => {
    await request(app)
      .put("/api/admin/event-center-settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        venueTypes: [
          {
            key: "OUTDOOR_VENUE",
            label: "Outdoor venue",
            enabled: false,
            featured: false,
            sortOrder: 6,
          },
        ],
      });

    const response = await request(app)
      .post("/api/event-centers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        venueName: "Restricted Garden",
        venueType: "OUTDOOR_VENUE",
        isDraft: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("venue type is not available");
  });

  it("rejects a configuration that disables every booking mode", async () => {
    const response = await request(app)
      .put("/api/admin/event-center-settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        booking: {
          instantBookingEnabled: false,
          reviewBookingEnabled: false,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("booking mode");
  });
});
