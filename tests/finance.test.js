const request = require("supertest");
const app = require("../app");
const User = require("../models/user/user.schema");
const Event = require("../models/user/event.schema");
const EventBooking = require("../models/user/eventBooking.schema");
const EventCenter = require("../models/user/eventCenter.schema");
const EventCenterBooking = require("../models/user/eventCenterBooking.schema");
const { generateAuthToken } = require("./setup");

describe("Finance Dashboard & Revenue API (/api/finance-dashboard)", () => {
  let organiser;
  let token;

  beforeEach(async () => {
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash("Password123!", 10);

    organiser = await User.create({
      firstName: "Finance",
      surname: "Organiser",
      email: "finance@example.com",
      password: hashedPassword,
      dob: new Date("1991-01-01"),
      roles: ["user", "organiser"],
      bankDetails: {
        accountNumber: "0123456789",
        bankCode: "058",
        bankName: "Guaranty Trust Bank",
        accountName: "Finance Organiser",
      },
    });
    token = generateAuthToken(organiser);
  });

  it("should return correct revenue calculations and empty initial stats", async () => {
    const res = await request(app)
      .get("/api/finance-dashboard/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("balance");
    expect(res.body.data).toHaveProperty("breakdown");
    expect(res.body.data).toHaveProperty("transactions");
    expect(res.body.data.balance.totalEarnings).toBe(0);
  });

  it("should aggregate revenue correctly when event bookings exist", async () => {
    const event = await Event.create({
      title: "Concert A",
      category: "Music",
      schedule: {
        startDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      },
      createdBy: organiser._id,
      status: "LISTED",
    });

    await EventBooking.create({
      eventId: event._id,
      buyer: organiser._id,
      paymentReference: "REF_FIN_1",
      paymentStatus: "COMPLETED",
      paymentMethod: "CARD",
      totalAmount: 5000000, // 50,000 NGN in kobo
      items: [
        {
          ticketId: event._id,
          name: "VIP",
          quantity: 2,
          pricePerUnit: 2500000,
          totalPrice: 5000000,
        },
      ],
    });

    const res = await request(app)
      .get("/api/finance-dashboard/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.breakdown.ticketRevenue).toBe(50000);
  });

  it("should verify password before sensitive financial updates", async () => {
    const resSuccess = await request(app)
      .post("/api/finance-dashboard/verify-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "Password123!" });

    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body.success).toBe(true);

    const resFail = await request(app)
      .post("/api/finance-dashboard/verify-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "IncorrectPassword" });

    expect(resFail.status).toBe(401);
    expect(resFail.body.success).toBe(false);
  });
});
