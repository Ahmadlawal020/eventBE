const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../app");
const User = require("../models/user/user.schema");
const Event = require("../models/user/event.schema");
const EventCenter = require("../models/user/eventCenter.schema");
const CoOrganiserInvitation = require("../models/user/coOrganiserInvitation.schema");
const { generateAuthToken } = require("./setup");

// Mock dispatchNotification to avoid outbound email/push network requests during tests
jest.mock("../services/notification", () => {
  const actual = jest.requireActual("../services/notification");
  return {
    ...actual,
    dispatchNotification: jest.fn().mockResolvedValue({ success: true }),
  };
});

jest.setTimeout(120000);

describe("Co-Organiser API Tests", () => {
  let hostUser;
  let hostToken;
  let coOrganiserUser;
  let coOrganiserToken;
  let otherUser;
  let otherToken;
  let testEvent;
  let testEventCenter;
  let hashedPassword;

  const rawPassword = "Password123!";

  beforeAll(async () => {
    // Hash password once using fast salt rounds for testing
    hashedPassword = await bcrypt.hash(rawPassword, 4);
  });

  beforeEach(async () => {
    // 1. Create Host User
    hostUser = await User.create({
      firstName: "Host",
      surname: "Organiser",
      email: `host_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
      password: hashedPassword,
      dob: new Date("1990-01-01"),
      roles: ["user", "organiser"],
    });
    hostToken = generateAuthToken(hostUser);

    // 2. Create Co-Organiser User
    coOrganiserUser = await User.create({
      firstName: "Co",
      surname: "Organiser",
      email: `co_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
      password: hashedPassword,
      dob: new Date("1993-05-15"),
      roles: ["user", "organiser"],
    });
    coOrganiserToken = generateAuthToken(coOrganiserUser);

    // 3. Create Other User
    otherUser = await User.create({
      firstName: "Other",
      surname: "User",
      email: `other_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
      password: hashedPassword,
      dob: new Date("1995-10-20"),
      roles: ["user"],
    });
    otherToken = generateAuthToken(otherUser);

    // 4. Create Host's Event
    testEvent = await Event.create({
      title: "Tech Summit 2026",
      description: "A premier tech summit",
      category: "Technology",
      schedule: {
        startDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
        startTime: "10:00",
        endTime: "18:00",
      },
      location: {
        address: "Victoria Island",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
      venueName: "Eko Convention Centre",
      createdBy: hostUser._id,
      status: "LISTED",
      coOrganisers: [],
    });

    // 5. Create Host's Event Center
    testEventCenter = await EventCenter.create({
      name: "Grand Ballroom",
      venueName: "Grand Ballroom Center",
      description: "Spacious event center",
      category: "CONFERENCE_HALL",
      capacity: 500,
      location: {
        address: "Lekki Phase 1",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
      pricePerDay: { amountCents: 50000000 },
      createdBy: hostUser._id,
      status: "LISTED",
      coOrganisers: [],
    });
  });

  describe("GET /api/co-organisers/check-user", () => {
    it("should return 400 if email is missing", async () => {
      const res = await request(app)
        .get("/api/co-organisers/check-user")
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Email is required/i);
    });

    it("should return 404 if user is not found", async () => {
      const res = await request(app)
        .get("/api/co-organisers/check-user?email=nonexistent@example.com")
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/User not found/i);
    });

    it("should return 200 and user data if user exists", async () => {
      const res = await request(app)
        .get(`/api/co-organisers/check-user?email=${coOrganiserUser.email}`)
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(coOrganiserUser.email);
      expect(res.body.data.firstName).toBe("Co");
      expect(res.body.data.surname).toBe("Organiser");
    });
  });

  describe("POST /api/co-organisers/invite", () => {
    it("should return 400 if required fields are missing", async () => {
      const res = await request(app)
        .post("/api/co-organisers/invite")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({ coOrganiserEmail: "test@example.com" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 403 if host does not own the listing", async () => {
      const otherEvent = await Event.create({
        title: "Other Person's Event",
        description: "Not owned by host",
        category: "Technology",
        schedule: {
          startDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
        },
        location: { address: "Ikeja", city: "Lagos", state: "Lagos", country: "Nigeria" },
        createdBy: otherUser._id,
        status: "LISTED",
      });

      const res = await request(app)
        .post("/api/co-organisers/invite")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          coOrganiserEmail: coOrganiserUser.email,
          listings: [{ listingId: String(otherEvent._id), listingType: "Event" }],
          permissions: ["MANAGE_LISTING", "MANAGE_TICKETS"],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Authorization failed/i);
    });

    it("should successfully invite a registered co-organiser", async () => {
      const res = await request(app)
        .post("/api/co-organisers/invite")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          coOrganiserEmail: coOrganiserUser.email,
          listings: [
            { listingId: String(testEvent._id), listingType: "Event" },
            { listingId: String(testEventCenter._id), listingType: "EventCenter" },
          ],
          permissions: ["ALL_ACCESS", "MANAGE_LISTING"],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PENDING");
      expect(res.body.data.coOrganiser.toString()).toBe(coOrganiserUser._id.toString());
      expect(res.body.data.listings).toHaveLength(2);
    });

    it("should prevent duplicate pending invitations for the same co-organiser email", async () => {
      // First invite
      await request(app)
        .post("/api/co-organisers/invite")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          coOrganiserEmail: coOrganiserUser.email,
          listings: [{ listingId: String(testEvent._id), listingType: "Event" }],
          permissions: ["MANAGE_LISTING"],
        });

      // Second invite (duplicate)
      const res = await request(app)
        .post("/api/co-organisers/invite")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          coOrganiserEmail: coOrganiserUser.email,
          listings: [{ listingId: String(testEvent._id), listingType: "Event" }],
          permissions: ["ALL_ACCESS"],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it("should prevent host from inviting themselves as co-organiser", async () => {
      const res = await request(app)
        .post("/api/co-organisers/invite")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          coOrganiserEmail: hostUser.email,
          listings: [{ listingId: String(testEvent._id), listingType: "Event" }],
          permissions: ["ALL_ACCESS"],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot invite yourself/i);
    });

    it("should prevent inviting a user who is already an active co-organiser on the listing", async () => {
      // Add coOrganiserUser to testEvent
      await Event.findByIdAndUpdate(testEvent._id, {
        $addToSet: { coOrganisers: coOrganiserUser._id },
      });

      const res = await request(app)
        .post("/api/co-organisers/invite")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          coOrganiserEmail: coOrganiserUser.email,
          listings: [{ listingId: String(testEvent._id), listingType: "Event" }],
          permissions: ["ALL_ACCESS"],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already an active co-organiser/i);
    });
  });

  describe("GET /api/co-organisers/my-invitations and /received-invitations", () => {
    let invitation;

    beforeEach(async () => {
      invitation = await CoOrganiserInvitation.create({
        host: hostUser._id,
        coOrganiserEmail: coOrganiserUser.email,
        coOrganiser: coOrganiserUser._id,
        listings: [{ listingId: testEvent._id, listingType: "Event" }],
        permissions: ["MANAGE_LISTING", "MANAGE_TICKETS"],
        status: "PENDING",
      });
    });

    it("should fetch invitations sent by host", async () => {
      const res = await request(app)
        .get("/api/co-organisers/my-invitations")
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]._id.toString()).toBe(invitation._id.toString());
    });

    it("should fetch invitations received by co-organiser", async () => {
      const res = await request(app)
        .get("/api/co-organisers/received-invitations")
        .set("Authorization", `Bearer ${coOrganiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]._id.toString()).toBe(invitation._id.toString());
    });

    it("should retrieve single invitation by id", async () => {
      const res = await request(app)
        .get(`/api/co-organisers/invitations/${invitation._id}`)
        .set("Authorization", `Bearer ${coOrganiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data._id.toString()).toBe(invitation._id.toString());
    });
  });

  describe("POST /api/co-organisers/invitations/:id/respond", () => {
    let invitation;

    beforeEach(async () => {
      invitation = await CoOrganiserInvitation.create({
        host: hostUser._id,
        coOrganiserEmail: coOrganiserUser.email,
        coOrganiser: coOrganiserUser._id,
        listings: [
          { listingId: testEvent._id, listingType: "Event" },
          { listingId: testEventCenter._id, listingType: "EventCenter" },
        ],
        permissions: ["MANAGE_LISTING", "MANAGE_BOOKINGS"],
        status: "PENDING",
      });
    });

    it("should return 400 for invalid action", async () => {
      const res = await request(app)
        .post(`/api/co-organisers/invitations/${invitation._id}/respond`)
        .set("Authorization", `Bearer ${coOrganiserToken}`)
        .send({ action: "INVALID_STATUS" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should accept invitation and add co-organiser to listings", async () => {
      const res = await request(app)
        .post(`/api/co-organisers/invitations/${invitation._id}/respond`)
        .set("Authorization", `Bearer ${coOrganiserToken}`)
        .send({ action: "ACCEPTED" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ACCEPTED");

      // Verify co-organiser was added to event
      const updatedEvent = await Event.findById(testEvent._id);
      expect(
        updatedEvent.coOrganisers.some(
          (id) => id.toString() === coOrganiserUser._id.toString()
        )
      ).toBe(true);

      // Verify co-organiser was added to event center
      const updatedCenter = await EventCenter.findById(testEventCenter._id);
      expect(
        updatedCenter.coOrganisers.some(
          (id) => id.toString() === coOrganiserUser._id.toString()
        )
      ).toBe(true);
    });

    it("should decline invitation and NOT add co-organiser to listings", async () => {
      const res = await request(app)
        .post(`/api/co-organisers/invitations/${invitation._id}/respond`)
        .set("Authorization", `Bearer ${coOrganiserToken}`)
        .send({ action: "DECLINED" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("DECLINED");

      const updatedEvent = await Event.findById(testEvent._id);
      expect(
        updatedEvent.coOrganisers.some(
          (id) => id.toString() === coOrganiserUser._id.toString()
        )
      ).toBe(false);
    });
  });

  describe("PATCH /api/co-organisers/permissions", () => {
    beforeEach(async () => {
      await CoOrganiserInvitation.create({
        host: hostUser._id,
        coOrganiserEmail: coOrganiserUser.email,
        coOrganiser: coOrganiserUser._id,
        listings: [{ listingId: testEvent._id, listingType: "Event" }],
        permissions: ["MANAGE_LISTING"],
        status: "ACCEPTED",
      });
    });

    it("should successfully update permissions for accepted co-organiser", async () => {
      const res = await request(app)
        .patch("/api/co-organisers/permissions")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          listingId: String(testEvent._id),
          coOrganiserId: String(coOrganiserUser._id),
          permissions: ["ALL_ACCESS", "VIEW_FINANCES"],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.permissions).toEqual(
        expect.arrayContaining(["ALL_ACCESS", "VIEW_FINANCES"])
      );
    });

    it("should return 404 if active invitation does not exist", async () => {
      const res = await request(app)
        .patch("/api/co-organisers/permissions")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          listingId: String(testEvent._id),
          coOrganiserId: String(otherUser._id),
          permissions: ["ALL_ACCESS"],
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /api/co-organisers/invitations/:id (Cancel Invitation)", () => {
    it("should cancel a pending invitation by host", async () => {
      const invitation = await CoOrganiserInvitation.create({
        host: hostUser._id,
        coOrganiserEmail: "random@example.com",
        listings: [{ listingId: testEvent._id, listingType: "Event" }],
        permissions: ["MANAGE_LISTING"],
        status: "PENDING",
      });

      const res = await request(app)
        .delete(`/api/co-organisers/invitations/${invitation._id}`)
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/cancelled successfully/i);

      const check = await CoOrganiserInvitation.findById(invitation._id);
      expect(check).toBeNull();
    });
  });

  describe("DELETE /api/co-organisers/remove", () => {
    beforeEach(async () => {
      // Add coOrganiser to testEvent
      await Event.findByIdAndUpdate(testEvent._id, {
        $addToSet: { coOrganisers: coOrganiserUser._id },
      });

      await CoOrganiserInvitation.create({
        host: hostUser._id,
        coOrganiserEmail: coOrganiserUser.email,
        coOrganiser: coOrganiserUser._id,
        listings: [{ listingId: testEvent._id, listingType: "Event" }],
        permissions: ["MANAGE_LISTING"],
        status: "ACCEPTED",
      });
    });

    it("should allow host to remove co-organiser from listing", async () => {
      const res = await request(app)
        .delete("/api/co-organisers/remove")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          listingId: String(testEvent._id),
          listingType: "Event",
          coOrganiserId: String(coOrganiserUser._id),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const event = await Event.findById(testEvent._id);
      expect(
        event.coOrganisers.some(
          (id) => id.toString() === coOrganiserUser._id.toString()
        )
      ).toBe(false);
    });

    it("should allow co-organiser to remove themselves with valid password", async () => {
      const res = await request(app)
        .delete("/api/co-organisers/remove")
        .set("Authorization", `Bearer ${coOrganiserToken}`)
        .send({
          listingId: String(testEvent._id),
          listingType: "Event",
          coOrganiserId: String(coOrganiserUser._id),
          password: rawPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/successfully left/i);

      const event = await Event.findById(testEvent._id);
      expect(
        event.coOrganisers.some(
          (id) => id.toString() === coOrganiserUser._id.toString()
        )
      ).toBe(false);
    });

    it("should fail when co-organiser attempts self-removal with incorrect password", async () => {
      const res = await request(app)
        .delete("/api/co-organisers/remove")
        .set("Authorization", `Bearer ${coOrganiserToken}`)
        .send({
          listingId: String(testEvent._id),
          listingType: "Event",
          coOrganiserId: String(coOrganiserUser._id),
          password: "WrongPassword123!",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Incorrect password/i);
    });
  });

  describe("Dashboard & Stats Endpoints", () => {
    beforeEach(async () => {
      // Add coOrganiser to testEvent and testEventCenter
      await Event.findByIdAndUpdate(testEvent._id, {
        $addToSet: { coOrganisers: coOrganiserUser._id },
      });
      await EventCenter.findByIdAndUpdate(testEventCenter._id, {
        $addToSet: { coOrganisers: coOrganiserUser._id },
      });

      await CoOrganiserInvitation.create({
        host: hostUser._id,
        coOrganiserEmail: coOrganiserUser.email,
        coOrganiser: coOrganiserUser._id,
        listings: [
          { listingId: testEvent._id, listingType: "Event" },
          { listingId: testEventCenter._id, listingType: "EventCenter" },
        ],
        permissions: ["ALL_ACCESS"],
        status: "ACCEPTED",
      });

      await CoOrganiserInvitation.create({
        host: hostUser._id,
        coOrganiserEmail: "pendingco@example.com",
        listings: [{ listingId: testEvent._id, listingType: "Event" }],
        permissions: ["MANAGE_LISTING"],
        status: "PENDING",
      });
    });

    it("GET /api/co-organisers/dashboard/stats should return accurate stats", async () => {
      const res = await request(app)
        .get("/api/co-organisers/dashboard/stats")
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("activeCoOrganisers", 1);
      expect(res.body.data).toHaveProperty("sharedListings", 2);
      expect(res.body.data).toHaveProperty("pendingInvitations", 1);
    });

    it("GET /api/co-organisers/all should list all co-organisers with shared listings count", async () => {
      const res = await request(app)
        .get("/api/co-organisers/all")
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0]._id.toString()).toBe(coOrganiserUser._id.toString());
      expect(res.body.data[0].sharedListingsCount).toBe(2);
    });

    it("GET /api/co-organisers/profile/:coOrganiserId should return detailed profile and accepted invitations", async () => {
      const res = await request(app)
        .get(`/api/co-organisers/profile/${coOrganiserUser._id}`)
        .set("Authorization", `Bearer ${hostToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("profile");
      expect(res.body.data).toHaveProperty("invitations");
      expect(res.body.data.invitations.length).toBe(1);
    });
  });
});
