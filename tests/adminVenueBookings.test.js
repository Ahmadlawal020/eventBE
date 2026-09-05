const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const EventCenterBooking = require("../models/client/eventCenterBooking.schema");
const { generateAdminAuthToken } = require("./setup");

describe("Admin venue booking operations API", () => {
  let token;
  let owner;
  let buyer;
  let venue;
  let confirmedBooking;
  let suffix;

  beforeEach(async () => {
    suffix = new mongoose.Types.ObjectId().toString();
    const [admin, createdOwner, createdBuyer] = await User.create([
      {
        firstName: "Booking",
        surname: "Admin",
        email: `booking.admin.${suffix}@example.com`,
        password: "Password123!",
        dob: new Date("1990-01-01"),
        roles: ["admin", "super_admin"],
      },
      {
        firstName: "Venue",
        surname: "Owner",
        email: `booking.owner.${suffix}@example.com`,
        password: "Password123!",
        dob: new Date("1990-01-01"),
      },
      {
        firstName: "Reservation",
        surname: "Guest",
        email: `booking.guest.${suffix}@example.com`,
        password: "Password123!",
        dob: new Date("1990-01-01"),
      },
    ]);
    token = generateAdminAuthToken(admin);
    owner = createdOwner;
    buyer = createdBuyer;
    venue = await EventCenter.create({
      venueName: `Reservations Hall ${suffix}`,
      venueType: "BANQUET_HALL",
      createdBy: owner._id,
      status: "LISTED",
      location: { city: "Lagos", country: "Nigeria" },
      capacity: { max: 300 },
      bookingSettings: "REVIEW",
    });

    confirmedBooking = await EventCenterBooking.create({
      buyer: buyer._id,
      guestDetails: {
        fullName: "Reservation Guest",
        email: buyer.email,
        phoneNumber: "+2348000000000",
      },
      organiser: owner._id,
      eventCenter: venue._id,
      selectedDates: [
        {
          date: new Date(Date.now() + 3 * 86400000),
          startTime: "09:00",
          endTime: "17:00",
        },
      ],
      bookingUnit: "day",
      duration: 1,
      totalPrice: { amount: 850000, currency: "NGN" },
      paymentStatus: "COMPLETED",
      paymentReference: `PAY-${suffix}`,
      status: "CONFIRMED",
      bookingMode: "REVIEW",
      reviewedAt: new Date(),
      ticketNumber: `MNS-BOOK-${suffix}`,
      qrPayload: "signed-secret-payload",
    });
    await EventCenterBooking.create({
      buyer: buyer._id,
      organiser: owner._id,
      eventCenter: venue._id,
      selectedDates: [{ date: new Date(Date.now() + 6 * 86400000) }],
      bookingUnit: "day",
      duration: 1,
      totalPrice: { amount: 250000, currency: "NGN" },
      paymentStatus: "PENDING",
      status: "PENDING_REVIEW",
      bookingMode: "REVIEW",
      reviewDeadline: new Date(Date.now() - 86400000),
    });
  });

  it("searches and filters venue bookings with operational metrics", async () => {
    const response = await request(app)
      .get("/api/admin/bookings")
      .query({
        type: "event-center",
        search: buyer.email,
        status: "CONFIRMED",
        bookingMode: "REVIEW",
        dateRange: "upcoming",
      })
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.bookings).toHaveLength(1);
    expect(response.body.data.pagination.total).toBe(1);
    expect(response.body.data.bookings[0]._id).toBe(
      String(confirmedBooking._id),
    );
    expect(response.body.data.bookings[0].eventCenter.venueName).toBe(
      venue.venueName,
    );
    expect(response.body.data.bookings[0].qrPayload).toBeUndefined();
    expect(
      response.body.data.metrics.eventCenters.total,
    ).toBeGreaterThanOrEqual(2);
    expect(
      response.body.data.metrics.eventCenters.pendingReview,
    ).toBeGreaterThanOrEqual(1);
    expect(
      response.body.data.metrics.eventCenters.confirmed,
    ).toBeGreaterThanOrEqual(1);
    expect(
      response.body.data.metrics.eventCenters.revenue,
    ).toBeGreaterThanOrEqual(850000);
  });

  it("returns secure detail and validates audited status changes", async () => {
    const detailResponse = await request(app)
      .get(`/api/admin/bookings/event-center/${confirmedBooking._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.booking.buyer.email).toBe(buyer.email);
    expect(detailResponse.body.data.booking.eventCenter.venueName).toBe(
      venue.venueName,
    );
    expect(detailResponse.body.data.booking.hasQrPayload).toBe(true);
    expect(detailResponse.body.data.booking.qrPayload).toBeUndefined();

    const updateResponse = await request(app)
      .patch(`/api/admin/bookings/event-center/${confirmedBooking._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        status: "COMPLETED",
        paymentStatus: "REFUNDED",
        reason: "Reservation reconciled by operations",
      });
    expect(updateResponse.status).toBe(200);
    const updated = await EventCenterBooking.findById(confirmedBooking._id);
    expect(updated.status).toBe("COMPLETED");
    expect(updated.paymentStatus).toBe("REFUNDED");

    const invalidState = await request(app)
      .patch(`/api/admin/bookings/event-center/${confirmedBooking._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "NOT_A_REAL_STATUS" });
    expect(invalidState.status).toBe(400);

    const invalidId = await request(app)
      .get("/api/admin/bookings/event-center/not-an-object-id")
      .set("Authorization", `Bearer ${token}`);
    expect(invalidId.status).toBe(400);
  });
});
