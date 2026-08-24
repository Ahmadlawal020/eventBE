const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../app");
const User = require("../models/user/user.schema");
const Event = require("../models/user/event.schema");
const EventCenter = require("../models/user/eventCenter.schema");
const StaffInvitation = require("../models/user/staffInvitation.schema");
const CoOrganiserInvitation = require("../models/user/coOrganiserInvitation.schema");
const StaffActivity = require("../models/user/staffActivity.schema");
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

describe("Staff API Tests", () => {
  let organiserUser;
  let organiserToken;
  let coOrganiserUser;
  let coOrganiserToken;
  let staffUser;
  let staffToken;
  let otherUser;
  let otherToken;
  let testEvent;
  let testEventCenter;
  let hashedPassword;

  const rawPassword = "Password123!";

  beforeAll(async () => {
    hashedPassword = await bcrypt.hash(rawPassword, 4);
  });

  beforeEach(async () => {
    // 1. Create Organiser User
    organiserUser = await User.create({
      firstName: "Organiser",
      surname: "Boss",
      email: `organiser_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
      password: hashedPassword,
      dob: new Date("1990-01-01"),
      roles: ["user", "organiser"],
    });
    organiserToken = generateAuthToken(organiserUser);

    // 2. Create Co-Organiser User
    coOrganiserUser = await User.create({
      firstName: "Co",
      surname: "Organiser",
      email: `co_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
      password: hashedPassword,
      dob: new Date("1992-03-10"),
      roles: ["user", "organiser"],
    });
    coOrganiserToken = generateAuthToken(coOrganiserUser);

    // 3. Create Staff User
    staffUser = await User.create({
      firstName: "John",
      surname: "Staff",
      email: `staff_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
      password: hashedPassword,
      dob: new Date("1995-06-15"),
      roles: ["user"],
    });
    staffToken = generateAuthToken(staffUser);

    // 4. Create Other User
    otherUser = await User.create({
      firstName: "Other",
      surname: "Person",
      email: `other_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`,
      password: hashedPassword,
      dob: new Date("1998-08-20"),
      roles: ["user"],
    });
    otherToken = generateAuthToken(otherUser);

    // 5. Create Organiser's Event
    testEvent = await Event.create({
      title: "Lagos Music Festival",
      description: "Annual concert",
      category: "Music",
      schedule: {
        startDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
        startTime: "18:00",
        endTime: "23:00",
      },
      location: {
        address: "Eko Atlantic",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
      venueName: "Eko Atlantic City",
      createdBy: organiserUser._id,
      status: "LISTED",
      coOrganisers: [],
      staff: [],
    });

    // 6. Create Organiser's Event Center
    testEventCenter = await EventCenter.create({
      name: "Grand Arena Hall",
      venueName: "Grand Arena",
      description: "Spacious luxury hall",
      category: "CONFERENCE_HALL",
      capacity: 1000,
      location: {
        address: "Victoria Island",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
      pricePerDay: { amountCents: 100000000 },
      createdBy: organiserUser._id,
      status: "LISTED",
      coOrganisers: [],
      staff: [],
    });
  });

  // Helper to create a standard staff invitation
  const createStaffInvite = async (overrides = {}) => {
    return await StaffInvitation.create({
      organiser: organiserUser._id,
      staffEmail: staffUser.email,
      staff: staffUser._id,
      listings: [{ listingId: testEvent._id, listingType: "Event" }],
      permissions: ["SCAN_TICKET"],
      status: "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    });
  };

  // ==========================================
  // 1. GET /api/staff/check-user
  // ==========================================
  describe("GET /api/staff/check-user", () => {
    it("should return 400 if email query parameter is missing", async () => {
      const res = await request(app)
        .get("/api/staff/check-user")
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/email is required/i);
    });

    it("should return 404 if user is not found", async () => {
      const res = await request(app)
        .get("/api/staff/check-user?email=nonexistent@example.com")
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/user not found/i);
    });

    it("should return 200 with user data when user exists", async () => {
      const res = await request(app)
        .get(`/api/staff/check-user?email=${staffUser.email}`)
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(staffUser.email);
      expect(res.body.data.firstName).toBe(staffUser.firstName);
    });
  });

  // ==========================================
  // 2. POST /api/staff/invite
  // ==========================================
  describe("POST /api/staff/invite", () => {
    it("should return 400 if required fields are missing or invalid", async () => {
      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({ staffEmail: staffUser.email });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 if organiser tries to invite themselves as staff", async () => {
      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          staffEmail: organiserUser.email,
          listings: [{ listingId: testEvent._id.toString(), listingType: "Event" }],
          permissions: ["SCAN_TICKET"],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot invite yourself/i);
    });

    it("should return 404 if listing does not exist", async () => {
      const fakeId = "60d5ec49f1b2c8b1f8e4e1a1";
      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          staffEmail: staffUser.email,
          listings: [{ listingId: fakeId, listingType: "Event" }],
          permissions: ["SCAN_TICKET"],
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/listing not found/i);
    });

    it("should return 403 if user does not own listing and is not an authorized co-organiser", async () => {
      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${otherToken}`)
        .send({
          staffEmail: staffUser.email,
          listings: [{ listingId: testEvent._id.toString(), listingType: "Event" }],
          permissions: ["SCAN_TICKET"],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/do not have permission/i);
    });

    it("should allow a co-organiser with MANAGE_STAFF permission to invite staff", async () => {
      await CoOrganiserInvitation.create({
        host: organiserUser._id,
        coOrganiser: coOrganiserUser._id,
        coOrganiserEmail: coOrganiserUser.email,
        listings: [{ listingId: testEvent._id, listingType: "Event" }],
        permissions: ["MANAGE_STAFF"],
        status: "ACCEPTED",
      });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { coOrganisers: coOrganiserUser._id } });

      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${coOrganiserToken}`)
        .send({
          staffEmail: staffUser.email,
          listings: [{ listingId: testEvent._id.toString(), listingType: "Event" }],
          permissions: ["SCAN_TICKET", "CUSTOMER_CARE"],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PENDING");
    });

    it("should return 400 if user is already a co-organiser on the listing", async () => {
      await CoOrganiserInvitation.create({
        host: organiserUser._id,
        coOrganiser: coOrganiserUser._id,
        coOrganiserEmail: coOrganiserUser.email,
        listings: [{ listingId: testEvent._id, listingType: "Event" }],
        permissions: ["MANAGE_LISTING"],
        status: "ACCEPTED",
      });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { coOrganisers: coOrganiserUser._id } });

      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          staffEmail: coOrganiserUser.email,
          listings: [{ listingId: testEvent._id.toString(), listingType: "Event" }],
          permissions: ["SCAN_TICKET"],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/co-organiser/i);
    });

    it("should return 400 if duplicate pending staff invitation exists", async () => {
      await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          staffEmail: staffUser.email,
          listings: [{ listingId: testEvent._id.toString(), listingType: "Event" }],
          permissions: ["SCAN_TICKET"],
        });

      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          staffEmail: staffUser.email,
          listings: [{ listingId: testEvent._id.toString(), listingType: "Event" }],
          permissions: ["SCAN_TICKET"],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already has a pending or accepted staff invitation/i);
    });

    it("should successfully invite an unregistered staff member by email", async () => {
      const newEmail = `unregistered_${Date.now()}@example.com`;
      const res = await request(app)
        .post("/api/staff/invite")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          staffEmail: newEmail,
          listings: [
            { listingId: testEvent._id.toString(), listingType: "Event" },
            { listingId: testEventCenter._id.toString(), listingType: "EventCenter" },
          ],
          permissions: ["SCAN_TICKET", "CUSTOMER_CARE"],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.staffEmail).toBe(newEmail);
      expect(res.body.data.staff).toBeNull();
      expect(res.body.data.status).toBe("PENDING");
    });
  });

  // ==========================================
  // 3. GET /api/staff/my-invitations & received-invitations
  // ==========================================
  describe("Staff Invitation Listing Endpoints", () => {
    it("GET /api/staff/my-invitations should return invitations sent by organiser", async () => {
      await createStaffInvite();

      const res = await request(app)
        .get("/api/staff/my-invitations")
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].staffEmail).toBe(staffUser.email);
    });

    it("GET /api/staff/received-invitations should return invitations received by staff", async () => {
      await createStaffInvite();

      const res = await request(app)
        .get("/api/staff/received-invitations")
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].staffEmail).toBe(staffUser.email);
    });
  });

  // ==========================================
  // 4. GET /api/staff/invitations/:id
  // ==========================================
  describe("GET /api/staff/invitations/:id", () => {
    it("should return 404 for nonexistent invitation ID", async () => {
      const fakeId = "60d5ec49f1b2c8b1f8e4e1a1";
      const res = await request(app)
        .get(`/api/staff/invitations/${fakeId}`)
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should return 200 with invitation data", async () => {
      const invitation = await createStaffInvite();

      const res = await request(app)
        .get(`/api/staff/invitations/${invitation._id}`)
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data._id.toString()).toBe(invitation._id.toString());
    });
  });

  // ==========================================
  // 5. PATCH /api/staff/respond/:id
  // ==========================================
  describe("PATCH /api/staff/respond/:id", () => {
    it("should return 400 for invalid action", async () => {
      const invitation = await createStaffInvite();

      const res = await request(app)
        .patch(`/api/staff/respond/${invitation._id}`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ action: "MAYBE" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid action/i);
    });

    it("should decline an invitation successfully", async () => {
      const invitation = await createStaffInvite();

      const res = await request(app)
        .patch(`/api/staff/respond/${invitation._id}`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ action: "DECLINED" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("DECLINED");

      const updatedInvite = await StaffInvitation.findById(invitation._id);
      expect(updatedInvite.status).toBe("DECLINED");
    });

    it("should accept an invitation, assign staff to listings, and add staff role to user", async () => {
      const invitation = await createStaffInvite({
        listings: [
          { listingId: testEvent._id, listingType: "Event" },
          { listingId: testEventCenter._id, listingType: "EventCenter" },
        ],
      });

      const res = await request(app)
        .patch(`/api/staff/respond/${invitation._id}`)
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ action: "ACCEPTED" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ACCEPTED");

      // Verify event has staff member
      const updatedEvent = await Event.findById(testEvent._id);
      expect(updatedEvent.staff.map(id => id.toString())).toContain(staffUser._id.toString());

      // Verify event center has staff member
      const updatedCenter = await EventCenter.findById(testEventCenter._id);
      expect(updatedCenter.staff.map(id => id.toString())).toContain(staffUser._id.toString());

      // Verify user has 'staff' role
      const updatedUser = await User.findById(staffUser._id);
      expect(updatedUser.roles).toContain("staff");
    });
  });

  // ==========================================
  // 6. DELETE /api/staff/cancel/:id
  // ==========================================
  describe("DELETE /api/staff/cancel/:id", () => {
    it("should return 404 if non-organiser tries to cancel invitation", async () => {
      const invitation = await createStaffInvite();

      const res = await request(app)
        .delete(`/api/staff/cancel/${invitation._id}`)
        .set("Authorization", `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should allow organiser to cancel pending invitation", async () => {
      const invitation = await createStaffInvite();

      const res = await request(app)
        .delete(`/api/staff/cancel/${invitation._id}`)
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/cancelled successfully/i);

      const checkInvite = await StaffInvitation.findById(invitation._id);
      expect(checkInvite).toBeNull();
    });
  });

  // ==========================================
  // 7. POST /api/staff/leave/:invitationId
  // ==========================================
  describe("POST /api/staff/leave/:invitationId", () => {
    it("should allow staff member to leave role and clean up role if no other listings", async () => {
      const invitation = await createStaffInvite({ status: "ACCEPTED" });

      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .post(`/api/staff/leave/${invitation._id}`)
        .set("Authorization", `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/successfully left/i);

      // Verify removed from event staff array
      const updatedEvent = await Event.findById(testEvent._id);
      expect(updatedEvent.staff.map(id => id.toString())).not.toContain(staffUser._id.toString());

      // Verify invitation status is LEFT
      const updatedInvite = await StaffInvitation.findById(invitation._id);
      expect(updatedInvite.status).toBe("LEFT");

      // Verify 'staff' role removed since no active staff assignments left
      const updatedUser = await User.findById(staffUser._id);
      expect(updatedUser.roles).not.toContain("staff");
    });
  });

  // ==========================================
  // 8. DELETE /api/staff/remove
  // ==========================================
  describe("DELETE /api/staff/remove", () => {
    it("should return 400 if required payload fields are missing", async () => {
      const res = await request(app)
        .delete("/api/staff/remove")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({ staffId: staffUser._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should remove staff member from listing and remove staff role", async () => {
      await createStaffInvite({ status: "ACCEPTED" });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .delete("/api/staff/remove")
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          listingId: testEvent._id.toString(),
          listingType: "Event",
          staffId: staffUser._id.toString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify event staff array
      const updatedEvent = await Event.findById(testEvent._id);
      expect(updatedEvent.staff.map(id => id.toString())).not.toContain(staffUser._id.toString());

      // Verify user roles
      const updatedUser = await User.findById(staffUser._id);
      expect(updatedUser.roles).not.toContain("staff");
    });
  });

  // ==========================================
  // 9. DELETE /api/staff/revoke-all/:staffId
  // ==========================================
  describe("DELETE /api/staff/revoke-all/:staffId", () => {
    it("should return 404 if no staff relationship exists", async () => {
      const res = await request(app)
        .delete(`/api/staff/revoke-all/${otherUser._id}`)
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should revoke all access across all listings for the staff member", async () => {
      await createStaffInvite({
        listings: [
          { listingId: testEvent._id, listingType: "Event" },
          { listingId: testEventCenter._id, listingType: "EventCenter" },
        ],
        status: "ACCEPTED",
      });

      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await EventCenter.findByIdAndUpdate(testEventCenter._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .delete(`/api/staff/revoke-all/${staffUser._id}`)
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify event staff
      const updatedEvent = await Event.findById(testEvent._id);
      expect(updatedEvent.staff.map(id => id.toString())).not.toContain(staffUser._id.toString());

      // Verify event center staff
      const updatedCenter = await EventCenter.findById(testEventCenter._id);
      expect(updatedCenter.staff.map(id => id.toString())).not.toContain(staffUser._id.toString());

      // Verify user roles
      const updatedUser = await User.findById(staffUser._id);
      expect(updatedUser.roles).not.toContain("staff");
    });
  });

  // ==========================================
  // 10. Dashboard & Management Endpoints
  // ==========================================
  describe("Staff Dashboard, Profile & Permission Management", () => {
    it("GET /api/staff/dashboard-stats should return counts for organiser", async () => {
      await createStaffInvite({ status: "ACCEPTED" });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .get("/api/staff/dashboard-stats")
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalStaff).toBe(1);
    });

    it("GET /api/staff/dashboard/stats should return aggregated dashboard metrics", async () => {
      await createStaffInvite({ status: "ACCEPTED" });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .get("/api/staff/dashboard/stats")
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("totalStaff");
      expect(res.body.data).toHaveProperty("performance");
    });

    it("GET /api/staff/all-staff should list staff members for organiser", async () => {
      await createStaffInvite({ status: "ACCEPTED" });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .get("/api/staff/all-staff")
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0]._id.toString()).toBe(staffUser._id.toString());
    });

    it("GET /api/staff/profile/:staffId should return detailed staff profile and stats", async () => {
      await createStaffInvite({ status: "ACCEPTED" });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .get(`/api/staff/profile/${staffUser._id}`)
        .set("Authorization", `Bearer ${organiserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile._id.toString()).toBe(staffUser._id.toString());
      expect(res.body.data.access.permissions).toContain("SCAN_TICKET");
    });

    it("PATCH /api/staff/access/:staffId should update permissions and listings", async () => {
      await createStaffInvite({ status: "ACCEPTED" });
      await Event.findByIdAndUpdate(testEvent._id, { $addToSet: { staff: staffUser._id } });
      await User.findByIdAndUpdate(staffUser._id, { $addToSet: { roles: "staff" } });

      const res = await request(app)
        .patch(`/api/staff/access/${staffUser._id}`)
        .set("Authorization", `Bearer ${organiserToken}`)
        .send({
          permissions: ["SCAN_TICKET", "CUSTOMER_CARE", "MANAGE_LISTING"],
          listings: [
            { listingId: testEvent._id.toString(), listingType: "Event" },
            { listingId: testEventCenter._id.toString(), listingType: "EventCenter" },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.permissions).toContain("MANAGE_LISTING");

      // Verify activity was logged
      const activity = await StaffActivity.findOne({
        staff: staffUser._id,
        action: "PERMISSION_CHANGE",
      });
      expect(activity).not.toBeNull();
    });
  });
});
