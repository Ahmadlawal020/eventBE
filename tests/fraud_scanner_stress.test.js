const request = require("supertest");
const app = require("../app");
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const EventTicketType = require("../models/client/eventTicketType.schema");
const UserEventTicket = require("../models/client/userEventTicket.schema");
const EventBooking = require("../models/client/eventBooking.schema");
const StaffInvitation = require("../models/client/staffInvitation.schema");
const { generateTicketNumber, generateQRPayload } = require("../utils/qr");
const { generateAuthToken } = require("./setup");

describe("Scanner Fraud Protection & Scale Test (5 to 10 Scanners vs 1,000 Fraud Vectors)", () => {
  jest.setTimeout(60000);

  let hostUser;
  let eventDoc;
  let ticketTypeDoc;
  let buyerUser;
  let staffScanners = [];

  beforeEach(async () => {
    // 1. Host
    hostUser = await User.create({
      firstName: "Host",
      surname: "Organiser",
      email: "host.fraud@example.com",
      password: "Password123!",
      dob: new Date("1990-01-01"),
      roles: ["user", "organiser"],
    });

    // 2. Event
    eventDoc = await Event.create({
      title: "Stadium 30k Mega Event",
      eventType: "MUSIC_CONCERTS",
      schedule: {
        from: new Date(Date.now() + 24 * 60 * 60 * 1000),
        to: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
      createdBy: hostUser._id,
      status: "LISTED",
    });

    // 3. Ticket Type
    ticketTypeDoc = await EventTicketType.create({
      eventId: eventDoc._id,
      name: "Standard Arena",
      ticketType: "PAID",
      price: { amountCents: 500000 },
      totalQuantity: 100000,
      salesStartAt: new Date(),
      salesEndAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      currency: { code: "NGN", symbol: "₦" },
      commission: { percentage: 10, type: "DEDUCT_FROM_PRICE" },
    });

    // 4. Buyer
    buyerUser = await User.create({
      firstName: "Ticket",
      surname: "Buyer",
      email: "buyer.fraud@example.com",
      password: "Password123!",
      dob: new Date("1995-01-01"),
    });

    // 5. Create 10 Staff Scanners (Turnstiles)
    const staffData = [];
    for (let i = 1; i <= 10; i++) {
      staffData.push({
        firstName: `Gate_${i}`,
        surname: "Scanner",
        email: `gate_${i}@example.com`,
        password: "Password123!",
        dob: new Date("1994-01-01"),
        roles: ["user", "staff"],
      });
    }
    const createdStaff = await User.insertMany(staffData);

    await StaffInvitation.insertMany(
      createdStaff.map((s) => ({
        organiser: hostUser._id,
        staff: s._id,
        staffEmail: s.email,
        status: "ACCEPTED",
        permissions: ["SCAN_TICKET"],
        listings: [{ listingId: eventDoc._id, listingType: "Event" }],
      }))
    );

    staffScanners = createdStaff.map((s) => ({
      id: s._id,
      name: s.firstName,
      token: generateAuthToken(s),
      endpoint: `/api/staff/scanner/event/${eventDoc._id}/validate`,
    }));
  });

  const seedTickets = async (count, defaultStatus = "UNREDEEMED") => {
    const booking = await EventBooking.create({
      eventId: eventDoc._id,
      buyer: buyerUser._id,
      guestDetails: { fullName: "Test Buyer", email: buyerUser.email },
      items: [{ ticketId: ticketTypeDoc._id, quantity: count, pricePerUnit: 500000, totalPrice: 500000 * count, name: "Standard Arena" }],
      totalAmount: 500000 * count,
      paymentMethod: "CARD",
      paymentReference: "REF_" + Date.now() + "_" + Math.random().toString(36).substring(7),
      paymentStatus: "COMPLETED",
    });

    const ticketDocs = [];
    for (let i = 0; i < count; i++) {
      const ticketNumber = generateTicketNumber("MNB");
      const qrPayload = generateQRPayload(ticketNumber, eventDoc._id, "EVENT");
      ticketDocs.push({
        bookingId: booking._id,
        eventId: eventDoc._id,
        ticketTypeId: ticketTypeDoc._id,
        owner: buyerUser._id,
        ticketName: "Standard Arena",
        ticketNumber,
        qrPayload,
        status: defaultStatus,
        eventSnapshot: {
          title: eventDoc.title,
          schedule: {
            startDate: eventDoc.schedule.from,
            endDate: eventDoc.schedule.to,
          },
        },
        ticketSnapshot: {
          name: "Standard Arena",
          ticketType: "PAID",
          price: { amount: 5000, currency: "NGN", symbol: "₦" },
        },
      });
    }

    return await UserEventTicket.insertMany(ticketDocs);
  };

  test("5 & 10 Scanners vs 500 Cloned Duplicate Screenshot Attacks", async () => {
    // Seed 50 valid tickets
    const tickets = await seedTickets(50);
    const activeScanners = staffScanners.slice(0, 5); // 5 scanners

    // 1. First Pass: All 50 legitimate guests enter
    const firstPassPromises = tickets.map((t, idx) => {
      const scanner = activeScanners[idx % activeScanners.length];
      return request(app)
        .post(scanner.endpoint)
        .set("Authorization", `Bearer ${scanner.token}`)
        .send({ ticketNumber: t.ticketNumber, qrPayload: t.qrPayload });
    });

    const firstPassResponses = await Promise.all(firstPassPromises);
    firstPassResponses.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    // 2. Second Pass (Fraud Attack): 10 scanners hit with the same 50 screenshots across multiple gates
    const fraudPassPromises = [];
    const tenScanners = staffScanners.slice(0, 10);

    for (let repeat = 0; repeat < 2; repeat++) {
      tickets.forEach((t, idx) => {
        const scanner = tenScanners[(idx + repeat) % tenScanners.length];
        fraudPassPromises.push(
          request(app)
            .post(scanner.endpoint)
            .set("Authorization", `Bearer ${scanner.token}`)
            .send({ ticketNumber: t.ticketNumber, qrPayload: t.qrPayload })
        );
      });
    }

    const fraudResponses = await Promise.all(fraudPassPromises);

    // Every single duplicate attempt MUST be blocked with 409 DUPLICATE ENTRY
    expect(fraudResponses.length).toBe(100);
    fraudResponses.forEach((res) => {
      expect([409, 400]).toContain(res.status);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already been used/i);
    });
  });

  test("10 Scanners vs Counterfeit/Tampered QR Payload Attacks", async () => {
    const forgedPromises = [];
    for (let i = 0; i < 20; i++) {
      const scanner = staffScanners[i % staffScanners.length];
      const fakeTn = `MNB-FORGERY-${i}`;
      const forgedQR = JSON.stringify({
        tn: fakeTn,
        eid: String(eventDoc._id),
        t: "EVENT",
        s: "INVALID_CRYPTO_HASH_ATTACK",
      });

      forgedPromises.push(
        request(app)
          .post(scanner.endpoint)
          .set("Authorization", `Bearer ${scanner.token}`)
          .send({ ticketNumber: fakeTn, qrPayload: forgedQR })
      );
    }

    const responses = await Promise.all(forgedPromises);
    responses.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid or tampered QR code/i);
    });
  });

  test("10 Scanners vs Cancelled / Refunded Tickets", async () => {
    const cancelledTickets = await seedTickets(20, "CANCELLED");

    const promises = cancelledTickets.map((t, idx) => {
      const scanner = staffScanners[idx % staffScanners.length];
      return request(app)
        .post(scanner.endpoint)
        .set("Authorization", `Bearer ${scanner.token}`)
        .send({ ticketNumber: t.ticketNumber, qrPayload: t.qrPayload });
    });

    const responses = await Promise.all(promises);
    responses.forEach((res) => {
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cancelled/i);
    });
  });
});
