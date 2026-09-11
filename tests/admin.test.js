const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const { generateAuthToken, generateAdminAuthToken } = require("./setup");

describe("Admin Management API (/api/admin)", () => {
  let regularUser;
  let adminUser;
  let regularToken;
  let adminToken;

  beforeEach(async () => {
    regularUser = await User.create({
      firstName: "Regular",
      surname: "Member",
      email: "regular@example.com",
      password: "Password123!",
      dob: new Date("1995-01-01"),
      roles: ["user"],
    });
    regularToken = generateAuthToken(regularUser);

    adminUser = await User.create({
      firstName: "Super",
      surname: "Admin",
      email: "admin@example.com",
      password: "Password123!",
      dob: new Date("1988-01-01"),
      roles: ["admin", "super_admin"],
    });
    adminToken = generateAdminAuthToken(adminUser);
  });

  it("should reject regular user from accessing admin dashboard (403 Forbidden)", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard/overview")
      .set("Authorization", `Bearer ${regularToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("should allow verified admin to access admin overview metrics", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard/overview")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty("data");
  });

  it("should allow admin to list users", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should return comprehensive user details including summary, events, centers, earnings, and scans", async () => {
    const res = await request(app)
      .get(`/api/admin/users/${regularUser._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("user");
    expect(res.body.data).toHaveProperty("summary");
    expect(res.body.data).toHaveProperty("events");
    expect(res.body.data).toHaveProperty("eventCenters");
    expect(res.body.data).toHaveProperty("earnings");
    expect(res.body.data).toHaveProperty("ticketScans");
    expect(res.body.data).toHaveProperty("customerActivity");
    expect(res.body.data.user.email).toBe("regular@example.com");
    expect(res.body.data.summary).toHaveProperty("dayJoined");
    expect(res.body.data.summary).toHaveProperty("isActive");
    expect(res.body.data.earnings).toHaveProperty("ticketSales");
    expect(res.body.data.earnings).toHaveProperty("venueBookings");
    expect(res.body.data.earnings).toHaveProperty("affiliation");
    expect(res.body.data.ticketScans).toHaveProperty("scansPerformedCount");
  });

  it("should allow updating user verification fields without crashing", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${regularUser._id}/verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isEmailVerified: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should enforce reason when suspending user account", async () => {
    const failRes = await request(app)
      .patch(`/api/admin/users/${regularUser._id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(failRes.status).toBe(400);

    const successRes = await request(app)
      .patch(`/api/admin/users/${regularUser._id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false, reason: "Suspicious activity detected" });

    expect(successRes.status).toBe(200);
    expect(successRes.body.success).toBe(true);
  });
});

