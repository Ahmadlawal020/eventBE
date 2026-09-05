const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const AdminAuditLog = require("../models/management/adminAuditLog.schema");
const { generateAdminAuthToken } = require("./setup");

describe("Event settings API", () => {
  let adminToken;

  beforeEach(async () => {
    const admin = await User.create({
      firstName: "Events",
      surname: "Admin",
      email: "events.admin@example.com",
      password: "Password123!",
      dob: new Date("1990-01-01"),
      roles: ["admin", "super_admin"],
    });
    adminToken = generateAdminAuthToken(admin);
  });

  it("persists admin changes and exposes a filtered public configuration", async () => {
    const initial = await request(app)
      .get("/api/admin/event-settings")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(initial.status).toBe(200);
    expect(initial.body.data.categories).toHaveLength(30);
    expect(initial.body.data.general.eventCreationEnabled).toBe(true);

    const update = await request(app)
      .put("/api/admin/event-settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        general: { eventCreationEnabled: false, defaultCurrency: "GHS" },
        ticketing: { maxTicketsPerOrder: 8 },
        categories: [
          {
            key: "MUSIC_CONCERTS",
            label: "Live music",
            enabled: false,
            featured: false,
            sortOrder: 0,
          },
        ],
      });

    expect(update.status).toBe(200);
    expect(update.body.data.general.eventCreationEnabled).toBe(false);
    expect(update.body.data.general.defaultCurrency).toBe("GHS");
    expect(update.body.data.ticketing.maxTicketsPerOrder).toBe(8);
    expect(
      update.body.data.categories.find(
        (option) => option.key === "MUSIC_CONCERTS",
      ),
    ).toMatchObject({ label: "Live music", enabled: false });

    const publicResponse = await request(app).get("/api/events/config");

    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body.data.general.eventCreationEnabled).toBe(false);
    expect(
      publicResponse.body.data.categories.some(
        (option) => option.key === "MUSIC_CONCERTS",
      ),
    ).toBe(false);

    const audit = await AdminAuditLog.findOne({
      action: "EVENT_SETTINGS_UPDATED",
    });
    expect(audit).not.toBeNull();
  });
});
