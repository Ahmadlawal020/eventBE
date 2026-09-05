const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const CoOrganiserInvitation = require("../models/client/coOrganiserInvitation.schema");
const StaffInvitation = require("../models/client/staffInvitation.schema");
const StaffActivity = require("../models/client/staffActivity.schema");
const { generateAdminAuthToken } = require("./setup");

describe("Admin event team API", () => {
  let token;
  let organiser;
  let coOrganiser;
  let staff;
  let event;
  let coOrganiserInvitation;
  let staffInvitation;
  let suffix;

  beforeEach(async () => {
    suffix = new mongoose.Types.ObjectId().toString();
    const [admin, createdOrganiser, createdCoOrganiser, createdStaff] =
      await User.create([
        {
          firstName: "Team",
          surname: "Admin",
          email: `team.admin.${suffix}@example.com`,
          password: "Password123!",
          dob: new Date("1990-01-01"),
          roles: ["admin", "super_admin"],
        },
        {
          firstName: "Event",
          surname: "Owner",
          email: `owner.${suffix}@example.com`,
          password: "Password123!",
          dob: new Date("1990-01-01"),
        },
        {
          firstName: "Collaboration",
          surname: "Lead",
          email: `coorganiser.${suffix}@example.com`,
          password: "Password123!",
          dob: new Date("1990-01-01"),
        },
        {
          firstName: "Gate",
          surname: "Manager",
          email: `staff.${suffix}@example.com`,
          password: "Password123!",
          dob: new Date("1990-01-01"),
        },
      ]);

    token = generateAdminAuthToken(admin);
    organiser = createdOrganiser;
    coOrganiser = createdCoOrganiser;
    staff = createdStaff;
    event = await Event.create({
      title: `Team Operations Summit ${suffix}`,
      eventType: "BUSINESS_NETWORKING",
      createdBy: organiser._id,
      status: "LISTED",
      schedule: {
        from: new Date(Date.now() + 86400000),
        to: new Date(Date.now() + 172800000),
      },
    });

    coOrganiserInvitation = await CoOrganiserInvitation.create({
      host: organiser._id,
      coOrganiserEmail: coOrganiser.email,
      coOrganiser: coOrganiser._id,
      listings: [{ listingId: event._id, listingType: "Event" }],
      permissions: ["MANAGE_LISTING", "VIEW_FINANCES"],
      status: "ACCEPTED",
    });
    staffInvitation = await StaffInvitation.create({
      organiser: organiser._id,
      staffEmail: staff.email,
      staff: staff._id,
      listings: [{ listingId: event._id, listingType: "Event" }],
      permissions: ["MANAGE_TICKETS", "SCAN_TICKET"],
      status: "ACCEPTED",
    });
    await StaffInvitation.create({
      organiser: organiser._id,
      staffEmail: `expired.${suffix}@example.com`,
      listings: [{ listingId: event._id, listingType: "Event" }],
      permissions: ["SCAN_TICKET"],
      status: "PENDING",
      expiresAt: new Date(Date.now() - 86400000),
    });
    await StaffActivity.create({
      staff: staff._id,
      organiser: organiser._id,
      action: "CHECK_IN",
      title: "Guest checked in",
      description: "Validated an event ticket at the main entrance.",
    });
  });

  it("searches both team views and returns global coverage metrics", async () => {
    const coOrganiserResponse = await request(app)
      .get("/api/admin/co-organisers")
      .query({ view: "co-organisers", search: coOrganiser.email })
      .set("Authorization", `Bearer ${token}`);

    expect(coOrganiserResponse.status).toBe(200);
    expect(coOrganiserResponse.body.data.invitations).toHaveLength(1);
    expect(coOrganiserResponse.body.data.pagination.total).toBe(1);
    expect(
      coOrganiserResponse.body.data.metrics.coOrganisers,
    ).toBeGreaterThanOrEqual(1);
    expect(
      coOrganiserResponse.body.data.metrics.staffMembers,
    ).toBeGreaterThanOrEqual(1);
    expect(
      coOrganiserResponse.body.data.metrics.pendingInvitations,
    ).toBeGreaterThanOrEqual(1);
    expect(
      coOrganiserResponse.body.data.metrics.expiredInvitations,
    ).toBeGreaterThanOrEqual(1);

    const staffResponse = await request(app)
      .get("/api/admin/co-organisers")
      .query({ view: "staff", status: "ACCEPTED", search: staff.email })
      .set("Authorization", `Bearer ${token}`);

    expect(staffResponse.status).toBe(200);
    expect(staffResponse.body.data.staffInvitations).toHaveLength(1);
    expect(staffResponse.body.data.staffInvitations[0]._id).toBe(
      String(staffInvitation._id),
    );
    expect(staffResponse.body.data.staffInvitations[0].staff.email).toBe(
      staff.email,
    );
  });

  it("returns populated listings and scoped staff activity in details", async () => {
    const staffResponse = await request(app)
      .get(`/api/admin/co-organisers/${staffInvitation._id}`)
      .query({ type: "staff" })
      .set("Authorization", `Bearer ${token}`);

    expect(staffResponse.status).toBe(200);
    expect(staffResponse.body.data.recordType).toBe("staff");
    expect(
      staffResponse.body.data.invitation.listings[0].listingDetails.title,
    ).toBe(event.title);
    expect(staffResponse.body.data.activityCount).toBe(1);
    expect(staffResponse.body.data.recentActivity[0].action).toBe("CHECK_IN");

    const coOrganiserResponse = await request(app)
      .get(`/api/admin/co-organisers/${coOrganiserInvitation._id}`)
      .query({ type: "co-organiser" })
      .set("Authorization", `Bearer ${token}`);

    expect(coOrganiserResponse.status).toBe(200);
    expect(coOrganiserResponse.body.data.recordType).toBe("co-organiser");
    expect(coOrganiserResponse.body.data.invitation.coOrganiser.email).toBe(
      coOrganiser.email,
    );

    const invalidResponse = await request(app)
      .get("/api/admin/co-organisers/not-an-object-id")
      .set("Authorization", `Bearer ${token}`);
    expect(invalidResponse.status).toBe(400);
  });
});
