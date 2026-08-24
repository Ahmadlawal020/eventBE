const request = require("supertest");
const app = require("../app");

describe("Health & Root Routes API", () => {
  it("GET /health should return 200 and UP status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "UP");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("database");
  });

  it("GET /api/health should also return 200 and health info", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UP");
  });

  it("GET /nonexistent-route should return 404", async () => {
    const res = await request(app)
      .get("/api/nonexistent-path-for-testing")
      .set("Accept", "application/json");
    expect(res.status).toBe(404);
  });
});
