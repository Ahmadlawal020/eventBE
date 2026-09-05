const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const { generateAuthToken } = require("./setup");

describe("Authentication API (/api/auth)", () => {
  const testUser = {
    firstName: "Test",
    surname: "User",
    email: "testuser@example.com",
    password: "Password123!",
    dob: "1995-05-15",
  };

  it("should check if email exists (returns false for new email)", async () => {
    const res = await request(app)
      .post("/api/auth/check")
      .send({ email: testUser.email });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exists).toBe(false);
  });

  it("should successfully register a new user", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send(testUser);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data.user.email).toBe(testUser.email.toLowerCase());

    const savedUser = await User.findOne({ email: testUser.email.toLowerCase() });
    expect(savedUser).not.toBeNull();
    expect(savedUser.firstName).toBe(testUser.firstName);
  });

  it("should reject duplicate signup with 409 Conflict", async () => {
    await request(app).post("/api/auth/signup").send(testUser);

    const res = await request(app)
      .post("/api/auth/signup")
      .send(testUser);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it("should login with correct credentials and return access token", async () => {
    await request(app).post("/api/auth/signup").send(testUser);

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: testUser.password,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data.user.email).toBe(testUser.email.toLowerCase());
  });

  it("should reject login with wrong password", async () => {
    await request(app).post("/api/auth/signup").send(testUser);

    const res = await request(app)
      .post("/api/auth/login")
      .send({
        email: testUser.email,
        password: "WrongPassword!",
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("should protect private routes when token is missing", async () => {
    const res = await request(app).get("/api/user-info/123456789012345678901234");
    expect(res.status).toBe(401);
  });

  it("should allow private routes when valid token is provided", async () => {
    const userDoc = await User.create({
      firstName: "Valid",
      surname: "Auth",
      email: "validauth@example.com",
      password: "Password123!",
      dob: new Date("1990-01-01"),
    });

    const token = generateAuthToken(userDoc);

    const res = await request(app)
      .get(`/api/user-info/${userDoc._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("validauth@example.com");
  });
});
