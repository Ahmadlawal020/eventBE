const request = require("supertest");
const crypto = require("crypto");
const app = require("../app");
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const EventTicketType = require("../models/client/eventTicketType.schema");
const EventBooking = require("../models/client/eventBooking.schema");
const UserEventTicket = require("../models/client/userEventTicket.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const EventCenterBooking = require("../models/client/eventCenterBooking.schema");

describe("Paystack Payment & Webhook API (/api/webhooks/payment)", () => {
  let buyer;
  let organiser;
  let eventDoc;
  let ticketTypeDoc;
  const secretKey = process.env.PAYSTACK_SECRET_KEY || "sk_test_mock_paystack_secret_key";

  beforeEach(async () => {
    buyer = await User.create({
      firstName: "Buyer",
      surname: "One",
      email: "buyer@example.com",
      password: "Password123!",
      dob: new Date("1995-01-01"),
    });

    organiser = await User.create({
      firstName: "Organiser",
      surname: "One",
      email: "eventhost@example.com",
      password: "Password123!",
      dob: new Date("1990-01-01"),
      roles: ["user", "organiser"],
    });

    eventDoc = await Event.create({
      title: "Afrobeats Live",
      category: "Concerts",
      schedule: {
        startDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
      },
      createdBy: organiser._id,
      status: "LISTED",
    });

    ticketTypeDoc = await EventTicketType.create({
      eventId: eventDoc._id,
      name: "Standard Ticket",
      ticketType: "PAID",
      price: { amountCents: 500000 },
      totalQuantity: 200,
      salesStartAt: new Date(),
      salesEndAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      currency: { code: "NGN", symbol: "₦" },
      commission: { percentage: 10, type: "DEDUCT_FROM_PRICE" },
    });
  });

  const signPayload = (payload) => {
    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha512", secretKey)
      .update(rawBody)
      .digest("hex");
    return { rawBody, signature };
  };

  it("should reject webhook request with missing or invalid signature (400)", async () => {
    const payload = { event: "charge.success", data: {} };

    const res = await request(app)
      .post("/api/webhooks/payment")
      .set("x-paystack-signature", "invalid-signature")
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.text).toContain("Invalid signature");
  });

  it("should process EVENT_TICKET webhook and issue tickets idempotently", async () => {
    const reference = "PAY_EVT_" + Date.now();
    const webhookPayload = {
      event: "charge.success",
      data: {
        reference,
        status: "success",
        amount: 1000000, // 10,000 NGN in kobo
        currency: "NGN",
        customer: { email: buyer.email, first_name: "Buyer" },
        metadata: {
          type: "EVENT_TICKET",
          eventId: String(eventDoc._id),
          buyerId: String(buyer._id),
          fullName: "Buyer One",
          phoneNumber: "08012345678",
          totalAmount: 1000000,
          items: [
            {
              ticketTypeId: String(ticketTypeDoc._id),
              quantity: 2,
              price: 5000,
              name: "Standard Ticket",
            },
          ],
        },
      },
    };

    const { rawBody, signature } = signPayload(webhookPayload);

    // 1. Send First Webhook
    const res1 = await request(app)
      .post("/api/webhooks/payment")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res1.status).toBe(200);

    // Verify booking was created
    const booking = await EventBooking.findOne({ paymentReference: reference });
    expect(booking).not.toBeNull();
    expect(booking.paymentStatus).toBe("COMPLETED");

    // Verify individual tickets were created (2 tickets)
    const tickets = await UserEventTicket.find({ bookingId: booking._id });
    expect(tickets.length).toBe(2);
    expect(tickets[0].qrPayload).toBeDefined();

    // 2. Send Duplicate Webhook (Idempotency Test)
    const res2 = await request(app)
      .post("/api/webhooks/payment")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res2.status).toBe(200);

    // Check no duplicate tickets were created
    const ticketsAfterDup = await UserEventTicket.find({ bookingId: booking._id });
    expect(ticketsAfterDup.length).toBe(2);
  });

  it("should process EVENT_CENTER instant booking webhook successfully", async () => {
    const eventCenter = await EventCenter.create({
      venueName: "Eko Convention Hall",
      category: "Convention Center",
      location: { address: "Victoria Island", city: "Lagos", state: "Lagos", country: "Nigeria" },
      createdBy: organiser._id,
      bookingSettings: "INSTANT",
      pricing: { perDay: 500000 },
      capacity: { maxGuests: 1000 },
    });

    const reference = "PAY_VENUE_" + Date.now();
    const webhookPayload = {
      event: "charge.success",
      data: {
        reference,
        status: "success",
        amount: 50000000,
        currency: "NGN",
        customer: { email: buyer.email, first_name: "Buyer" },
        metadata: {
          type: "EVENT_CENTER",
          eventCenterId: String(eventCenter._id),
          organiserId: String(organiser._id),
          buyerId: String(buyer._id),
          selectedDates: [{ date: "2026-10-01" }],
          bookingUnit: "day",
          duration: 1,
          totalPrice: { amount: 500000, currency: "NGN" },
          fullName: "Buyer One",
          phoneNumber: "08012345678",
          bookingMode: "INSTANT",
        },
      },
    };

    const { rawBody, signature } = signPayload(webhookPayload);

    const res = await request(app)
      .post("/api/webhooks/payment")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    const booking = await EventCenterBooking.findOne({ paymentReference: reference });
    expect(booking).not.toBeNull();
    expect(booking.paymentStatus).toBe("COMPLETED");
    expect(booking.ticketNumber).toBeDefined();
    expect(booking.qrPayload).toBeDefined();
  });
});
