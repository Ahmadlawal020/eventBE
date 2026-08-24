const request = require("supertest");
const app = require("../app");
const User = require("../models/user/user.schema");
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
});
