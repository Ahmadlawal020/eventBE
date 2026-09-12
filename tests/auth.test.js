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

  it("should not set Nigeria as default residential address country for new users", async () => {
    const newUser = await User.create({
      firstName: "Address",
      surname: "Tester",
      email: "addresstester@example.com",
      password: "Password123!",
      dob: new Date("1995-01-01"),
    });

    expect(newUser.residentialAddress?.country).toBeUndefined();
  });

  describe("Email Change Flow (/api/user-info/change-email)", () => {
    it("should reject email change if the address has been taken by another user", async () => {
      const user1 = await User.create({
        firstName: "User",
        surname: "One",
        email: "userone@example.com",
        password: "Password123!",
        dob: new Date("1990-01-01"),
      });

      await User.create({
        firstName: "User",
        surname: "Two",
        email: "existingtaken@example.com",
        password: "Password123!",
        dob: new Date("1990-01-01"),
      });

      const token1 = generateAuthToken(user1);

      const res = await request(app)
        .post("/api/user-info/change-email/request")
        .set("Authorization", `Bearer ${token1}`)
        .send({ newEmail: "existingtaken@example.com" });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("The address has been taken");
    });

    it("should send verification OTP when changing to an available email", async () => {
      const user = await User.create({
        firstName: "User",
        surname: "Three",
        email: "userthree@example.com",
        password: "Password123!",
        authProvider: "google",
        googleId: "google-12345",
        dob: new Date("1990-01-01"),
      });

      const token = generateAuthToken(user);

      const res = await request(app)
        .post("/api/user-info/change-email/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ newEmail: "brandnewemail@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should reject verification with incorrect code", async () => {
      const user = await User.create({
        firstName: "User",
        surname: "Four",
        email: "userfour@example.com",
        password: "Password123!",
        dob: new Date("1990-01-01"),
      });

      const token = generateAuthToken(user);

      const res = await request(app)
        .post("/api/user-info/change-email/verify")
        .set("Authorization", `Bearer ${token}`)
        .send({ newEmail: "userfournew@example.com", code: "000000" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should verify OTP, update email, and reset authProvider to local while clearing googleId", async () => {
      const OTP = require("../models/client/otp.schema");
      const user = await User.create({
        firstName: "Google",
        surname: "User",
        email: "googleuser@example.com",
        authProvider: "google",
        googleId: "google-auth-id-999",
        dob: new Date("1990-01-01"),
      });

      const token = generateAuthToken(user);
      const newEmail = "googleuser.new@example.com";

      // Request OTP
      await request(app)
        .post("/api/user-info/change-email/request")
        .set("Authorization", `Bearer ${token}`)
        .send({ newEmail });

      // Create a known OTP code
      await OTP.deleteMany({ identifier: newEmail, type: "email_change" });
      await OTP.create({
        identifier: newEmail,
        code: "654321",
        type: "email_change",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const verifyRes = await request(app)
        .post("/api/user-info/change-email/verify")
        .set("Authorization", `Bearer ${token}`)
        .send({ newEmail, code: "654321" });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.data.user.email).toBe(newEmail);
      expect(verifyRes.body.data.user.authProvider).toBe("local");
      expect(verifyRes.body.data.user.googleId).toBeUndefined();
      expect(verifyRes.body.data).toHaveProperty("accessToken");
      expect(verifyRes.body.data).toHaveProperty("refreshToken");

      // Verify in DB
      const updatedInDb = await User.findById(user._id);
      expect(updatedInDb.email).toBe(newEmail);
      expect(updatedInDb.authProvider).toBe("local");
      expect(updatedInDb.googleId).toBeUndefined();
      expect(updatedInDb.isEmailVerified).toBe(true);
    });
  });
});
