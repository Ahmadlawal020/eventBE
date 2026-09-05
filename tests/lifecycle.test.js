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
const StaffInvitation = require("../models/client/staffInvitation.schema");
const { generateAuthToken } = require("./setup");
const { verifyQRPayload } = require("../utils/qr");

describe("Complete End-to-End Lifecycle Test Suite (Event & Event Center)", () => {
  jest.setTimeout(120000);

  const secretKey = process.env.PAYSTACK_SECRET_KEY || "sk_test_mock_paystack_secret_key";

  const signWebhookPayload = (payload) => {
    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha512", secretKey)
      .update(rawBody)
      .digest("hex");
    return { rawBody, signature };
  };

  let hostUser, hostToken;
  let venueHostUser, venueHostToken;
  let buyerUser, buyerToken;
  let staffUser, staffToken;
  let unauthorizedUser, unauthorizedToken;

  beforeEach(async () => {
    // 1. Host Organiser
    hostUser = await User.create({
      firstName: "Event",
      surname: "Organiser",
      email: `host.${Date.now()}@example.com`,
      password: "Password123!",
      dob: new Date("1990-01-01"),
      roles: ["user", "organiser"],
    });
    hostToken = generateAuthToken(hostUser);

    // 2. Venue Host Organiser
    venueHostUser = await User.create({
      firstName: "Venue",
      surname: "Owner",
      email: `venuehost.${Date.now()}@example.com`,
      password: "Password123!",
      dob: new Date("1988-01-01"),
      roles: ["user", "organiser"],
    });
    venueHostToken = generateAuthToken(venueHostUser);

    // 3. Buyer User
    buyerUser = await User.create({
      firstName: "John",
      surname: "Doe",
      email: `buyer.${Date.now()}@example.com`,
      password: "Password123!",
      dob: new Date("1996-05-15"),
      roles: ["user"],
    });
    buyerToken = generateAuthToken(buyerUser);

    // 4. Staff User
    staffUser = await User.create({
      firstName: "Security",
      surname: "Guard",
      email: `staff.${Date.now()}@example.com`,
      password: "Password123!",
      dob: new Date("1994-03-20"),
      roles: ["user", "staff"],
    });
    staffToken = generateAuthToken(staffUser);

    // 5. Unauthorized User
    unauthorizedUser = await User.create({
      firstName: "Random",
      surname: "Person",
      email: `random.${Date.now()}@example.com`,
      password: "Password123!",
      dob: new Date("1998-07-07"),
      roles: ["user"],
    });
    unauthorizedToken = generateAuthToken(unauthorizedUser);
  });

  // ==========================================================================
  // SECTION 1: EVENT FULL LIFECYCLE
  // ==========================================================================
  describe("Event Lifecycle: Creation -> Ticket Tiers -> Booking -> Payment -> Minting -> Gate Scanning -> Stats", () => {
    it("should execute the full event lifecycle from creation to booking, payment, QR verification, check-in, and stats", async () => {
      // Step 1: Organiser creates an Event
      const eventPayload = {
        title: "Lagos AfroTech Summit 2026",
        description: "The biggest African technology and cultural convergence.",
        category: "Technology",
        schedule: {
          startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
          startTime: "09:00",
          endTime: "18:00",
        },
        location: {
          address: "Landmark Event Centre, Victoria Island",
          city: "Lagos",
          state: "Lagos",
          country: "Nigeria",
        },
        venueName: "Landmark Centre Grand Ballroom",
        status: "LISTED",
      };

      const eventRes = await request(app)
        .post("/api/events")
        .set("Authorization", `Bearer ${hostToken}`)
        .send(eventPayload);

      expect([200, 201]).toContain(eventRes.status);
      expect(eventRes.body.success).toBe(true);
      expect(eventRes.body.data._id).toBeDefined();
      const createdEventId = eventRes.body.data._id;

      // Step 2: Organiser creates Ticket Tiers (Free & Paid VIP)
      const freeTierRes = await request(app)
        .post("/api/event-tickets")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          eventId: createdEventId,
          name: "Standard Free Pass",
          description: "General admission entry",
          ticketType: "FREE",
          totalQuantity: 100,
          salesStartAt: new Date(),
          salesEndAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          currency: { code: "NGN", symbol: "₦" },
          commission: { percentage: 0, type: "DEDUCT_FROM_PRICE" },
        });

      expect([200, 201]).toContain(freeTierRes.status);
      const freeTicketTypeId = freeTierRes.body.data._id;

      const paidTierRes = await request(app)
        .post("/api/event-tickets")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          eventId: createdEventId,
          name: "VIP Executive Pass",
          description: "Access to VIP lounge and networking dinner",
          ticketType: "PAID",
          price: { amountCents: 2500000 }, // 25,000 NGN
          totalQuantity: 50,
          salesStartAt: new Date(),
          salesEndAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          currency: { code: "NGN", symbol: "₦" },
          commission: { percentage: 10, type: "DEDUCT_FROM_PRICE" },
        });

      expect([200, 201]).toContain(paidTierRes.status);
      const paidTicketTypeId = paidTierRes.body.data._id;

      // Step 3: Public Event Discovery & Detail Retrieval
      const publicListRes = await request(app).get("/api/events");
      expect(publicListRes.status).toBe(200);
      expect(publicListRes.body.success).toBe(true);

      const eventDetailRes = await request(app).get(`/api/events/${createdEventId}`);
      expect(eventDetailRes.status).toBe(200);
      expect(eventDetailRes.body.data.title).toBe(eventPayload.title);

      const tiersRes = await request(app).get(`/api/event-tickets?eventId=${createdEventId}`);
      expect(tiersRes.status).toBe(200);
      expect(tiersRes.body.data.length).toBe(2);

      // Step 4: Free Ticket Booking Flow
      const freeBookingRes = await request(app)
        .post("/api/event-bookings")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          eventId: createdEventId,
          items: [{ product: freeTicketTypeId, quantity: 2 }],
          paymentMethod: "FREE",
          totalAmount: 0,
        });

      expect(freeBookingRes.status).toBe(200);
      expect(freeBookingRes.body.success).toBe(true);
      expect(freeBookingRes.body.data.booking.paymentStatus).toBe("COMPLETED");

      // Verify 2 individual tickets generated with signed QR codes
      const freeTickets = await UserEventTicket.find({ bookingId: freeBookingRes.body.data.booking._id });
      expect(freeTickets.length).toBe(2);
      expect(freeTickets[0].ticketNumber).toMatch(/^MNB-/);
      expect(freeTickets[0].status).toBe("UNREDEEMED");

      const qrVerify = verifyQRPayload(freeTickets[0].qrPayload);
      expect(qrVerify.valid).toBe(true);
      expect(qrVerify.data.tn).toBe(freeTickets[0].ticketNumber);
      expect(qrVerify.data.eid).toBe(String(createdEventId));

      // Step 5: Paid Ticket Booking & Paystack Payment Processing
      const paidReference = `REF_PAID_${Date.now()}`;
      const webhookPayload = {
        event: "charge.success",
        data: {
          reference: paidReference,
          status: "success",
          amount: 2500000, // 25,000 NGN in kobo
          currency: "NGN",
          customer: { email: buyerUser.email },
          metadata: {
            type: "EVENT_TICKET",
            eventId: String(createdEventId),
            buyerId: String(buyerUser._id),
            fullName: "John Doe",
            phoneNumber: "08012345678",
            totalAmount: 2500000,
            items: [
              {
                ticketTypeId: String(paidTicketTypeId),
                ticketId: String(paidTicketTypeId),
                quantity: 1,
                price: 25000,
                pricePerUnit: 2500000,
                name: "VIP Executive Pass",
              },
            ],
          },
        },
      };

      const { rawBody, signature } = signWebhookPayload(webhookPayload);
      const webhookRes = await request(app)
        .post("/api/webhooks/payment")
        .set("Content-Type", "application/json")
        .set("x-paystack-signature", signature)
        .send(rawBody);

      expect(webhookRes.status).toBe(200);

      // Verify paid ticket generated in DB
      const paidBooking = await EventBooking.findOne({ paymentReference: paidReference });
      expect(paidBooking).not.toBeNull();
      expect(paidBooking.paymentStatus).toBe("COMPLETED");

      const paidTickets = await UserEventTicket.find({ bookingId: paidBooking._id });
      expect(paidTickets.length).toBe(1);
      expect(paidTickets[0].ticketNumber).toMatch(/^MNB-/);
      expect(paidTickets[0].status).toBe("UNREDEEMED");

      // Step 6: Buyer Views Their Tickets
      const myTicketsRes = await request(app)
        .get("/api/user-event-tickets/my-tickets")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(myTicketsRes.status).toBe(200);
      expect(myTicketsRes.body.data.length).toBeGreaterThanOrEqual(3);

      const singleTicketRes = await request(app)
        .get(`/api/user-event-tickets/${paidTickets[0]._id}`)
        .set("Authorization", `Bearer ${buyerToken}`);
      expect(singleTicketRes.status).toBe(200);
      expect(singleTicketRes.body.data.ticketNumber).toBe(paidTickets[0].ticketNumber);

      // Step 7: Organiser assigns Staff scanner
      const staffInvite = await StaffInvitation.create({
        organiser: hostUser._id,
        staff: staffUser._id,
        staffEmail: staffUser.email,
        status: "ACCEPTED",
        permissions: ["SCAN_TICKET", "ALL_ACCESS"],
        listings: [{ listingId: createdEventId, listingType: "Event" }],
      });
      expect(staffInvite._id).toBeDefined();

      // Step 8: Gate Non-destructive QR / Ticket Verification (Preview)
      const verifyRes = await request(app)
        .post("/api/user-event-tickets/verify")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ qrPayload: paidTickets[0].qrPayload });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.data.ticketNumber).toBe(paidTickets[0].ticketNumber);
      expect(verifyRes.body.data.status).toBe("UNREDEEMED");

      // Step 9: Gate Check-In Validation (Admit Guest)
      const checkInRes = await request(app)
        .post("/api/user-event-tickets/validate")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ qrPayload: paidTickets[0].qrPayload });

      expect(checkInRes.status).toBe(200);
      expect(checkInRes.body.success).toBe(true);
      expect(checkInRes.body.message).toMatch(/validated/i);

      // Verify DB ticket is now REDEEMED
      const updatedTicket = await UserEventTicket.findById(paidTickets[0]._id);
      expect(updatedTicket.status).toBe("REDEEMED");
      expect(updatedTicket.checkIn.isCheckedIn).toBe(true);

      // Step 10: Fraud & Abuse Vector Tests
      // A. Replay / Duplicate Screenshot Attack
      const duplicateRes = await request(app)
        .post("/api/user-event-tickets/validate")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ qrPayload: paidTickets[0].qrPayload });

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body.success).toBe(false);
      expect(duplicateRes.body.message).toMatch(/already been used/i);

      // B. Counterfeit / Tampered QR Attack
      const forgedPayload = JSON.stringify({
        tn: "MNB-FAKE-12345678",
        eid: String(createdEventId),
        ts: Date.now(),
        v: 1,
        type: "EVENT",
        sig: "bad_signature",
      });
      const forgedRes = await request(app)
        .post("/api/user-event-tickets/validate")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ qrPayload: forgedPayload });

      expect(forgedRes.status).toBe(400);
      expect(forgedRes.body.message).toMatch(/Invalid or tampered QR code/i);

      // C. Unauthorized Scanner Attempt
      const unauthRes = await request(app)
        .post("/api/user-event-tickets/validate")
        .set("Authorization", `Bearer ${unauthorizedToken}`)
        .send({ qrPayload: freeTickets[0].qrPayload });

      expect(unauthRes.status).toBe(403);

      // Step 11: Organiser Check-In Analytics
      const statsRes = await request(app)
        .get(`/api/user-event-tickets/stats/${createdEventId}`)
        .set("Authorization", `Bearer ${hostToken}`);

      expect(statsRes.status).toBe(200);
      expect(statsRes.body.data.total).toBe(3); // 2 Free + 1 Paid
      expect(statsRes.body.data.redeemed).toBe(1); // 1 Paid checked in
      expect(statsRes.body.data.unredeemed).toBe(2); // 2 Free pending
    });
  });

  // ==========================================================================
  // SECTION 2: EVENT CENTER (VENUE) FULL LIFECYCLE
  // ==========================================================================
  describe("Event Center Lifecycle: Venue Creation -> Instant/Review Booking -> Conflicts -> Check-In -> Decline Flow", () => {
    it("should execute instant booking lifecycle with date blocking and door check-in", async () => {
      // Step 1: Create Instant Booking Event Center
      const venuePayload = {
        venueName: "Eko Imperial Banquet Hall",
        venueType: "BANQUET_HALL",
        description: "Luxury 500-capacity hall for high-end events.",
        capacity: 500,
        bookingSettings: "INSTANT",
        basePrice: 150000, // 150,000 NGN per day
        location: {
          addressString: "Adetokunbo Ademola St, VI",
          city: "Lagos",
          state: "Lagos",
          country: "Nigeria",
        },
      };

      const venueRes = await request(app)
        .post("/api/event-centers")
        .set("Authorization", `Bearer ${venueHostToken}`)
        .send(venuePayload);

      expect(venueRes.status).toBe(201);
      const venueId = venueRes.body.data._id;

      // Update venue status to LISTED so it is publicly available
      await EventCenter.findByIdAndUpdate(venueId, { status: "LISTED" });

      // Step 2: Discovery
      const getVenuesRes = await request(app).get("/api/event-centers");
      expect(getVenuesRes.status).toBe(200);

      const venueDetailRes = await request(app).get(`/api/event-centers/${venueId}`);
      expect(venueDetailRes.status).toBe(200);
      expect(venueDetailRes.body.data.venueName).toBe(venuePayload.venueName);

      // Step 3: Instant Booking by Buyer (via Transfer / Instant generation)
      const bookingDate = "2026-11-20";
      const bookRes = await request(app)
        .post("/api/event-center-tickets")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          eventCenterId: venueId,
          selectedDates: [{ date: bookingDate }],
          bookingUnit: "day",
          duration: 1,
          totalPrice: { amount: 150000, currency: "NGN" },
          paymentMethod: "transfer",
        });

      expect(bookRes.status).toBe(201);
      expect(bookRes.body.success).toBe(true);
      const bookingDoc = bookRes.body.data;
      expect(bookingDoc.ticketNumber).toMatch(/^MNS-/);
      expect(bookingDoc.qrPayload).toBeDefined();

      // Verify date is blocked in venue availability
      const updatedVenue = await EventCenter.findById(venueId);
      const bookedDates = (updatedVenue.availability?.unavailableDates || []).map(
        (d) => new Date(d.date).toISOString().split("T")[0]
      );
      expect(bookedDates).toContain(bookingDate);

      // Step 4: Double-Booking Conflict Prevention
      const duplicateBookingRes = await request(app)
        .post("/api/event-center-tickets")
        .set("Authorization", `Bearer ${unauthorizedToken}`)
        .send({
          eventCenterId: venueId,
          selectedDates: [{ date: bookingDate }],
          bookingUnit: "day",
          duration: 1,
          totalPrice: { amount: 150000, currency: "NGN" },
          paymentMethod: "transfer",
        });

      expect(duplicateBookingRes.status).toBe(400);
      expect(duplicateBookingRes.body.message).toMatch(/no longer available/i);

      // Step 5: Buyer queries their venue tickets
      const myVenueTicketsRes = await request(app)
        .get("/api/event-center-tickets/my-tickets")
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(myVenueTicketsRes.status).toBe(200);
      expect(myVenueTicketsRes.body.data.length).toBeGreaterThanOrEqual(1);

      // Step 6: Assign Staff to Event Center
      await StaffInvitation.create({
        organiser: venueHostUser._id,
        staff: staffUser._id,
        staffEmail: staffUser.email,
        status: "ACCEPTED",
        permissions: ["SCAN_TICKET", "ALL_ACCESS"],
        listings: [{ listingId: venueId, listingType: "EventCenter" }],
      });

      // Step 7: Non-destructive verification (Venue Gate Preview)
      const verifyVenueRes = await request(app)
        .post("/api/event-center-tickets/verify-ticket")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ qrPayload: bookingDoc.qrPayload });

      expect(verifyVenueRes.status).toBe(200);
      expect(verifyVenueRes.body.data.ticketNumber).toBe(bookingDoc.ticketNumber);
      expect(verifyVenueRes.body.data.isCheckedIn).toBe(false);

      // Step 8: Door Validation / Check-In
      const validateVenueRes = await request(app)
        .post("/api/event-center-tickets/validate")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ qrPayload: bookingDoc.qrPayload });

      expect(validateVenueRes.status).toBe(200);
      expect(validateVenueRes.body.success).toBe(true);
      expect(validateVenueRes.body.message).toMatch(/validated/i);

      // Verify DB reflects check-in
      const checkedInBooking = await EventCenterBooking.findById(bookingDoc._id);
      expect(checkedInBooking.checkIn.isCheckedIn).toBe(true);

      // Step 9: Replay Attack on Venue Pass
      const duplicateVenueScan = await request(app)
        .post("/api/event-center-tickets/validate")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ qrPayload: bookingDoc.qrPayload });

      expect(duplicateVenueScan.status).toBe(409);
      expect(duplicateVenueScan.body.message).toMatch(/already been used/i);
    });

    it("should execute review mode booking lifecycle with accept and decline branches", async () => {
      // Step 1: Create Review-mode Event Center
      const reviewVenue = await EventCenter.create({
        venueName: "Serenity Gardens & Marquee",
        venueType: "OUTDOOR_VENUE",
        description: "Open garden for weddings and festivals.",
        capacity: 1000,
        bookingSettings: "REVIEW",
        basePrice: 300000,
        createdBy: venueHostUser._id,
        status: "LISTED",
      });

      // Step 2: Buyer requests booking
      const requestDate = "2026-12-10";
      const requestRes = await request(app)
        .post("/api/event-center-tickets")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          eventCenterId: reviewVenue._id,
          selectedDates: [{ date: requestDate }],
          bookingUnit: "day",
          duration: 1,
          totalPrice: { amount: 300000, currency: "NGN" },
          paymentMethod: "transfer",
        });

      expect(requestRes.status).toBe(201);
      const pendingBooking = requestRes.body.data;
      expect(pendingBooking.status).toBe("PENDING_REVIEW");
      expect(pendingBooking.bookingMode).toBe("REVIEW");
      expect(pendingBooking.reviewDeadline).toBeDefined();

      // Step 3: Organiser Accepts Booking
      const acceptRes = await request(app)
        .post(`/api/event-center-tickets/${pendingBooking._id}/accept`)
        .set("Authorization", `Bearer ${venueHostToken}`);

      expect(acceptRes.status).toBe(200);
      expect(acceptRes.body.success).toBe(true);
      expect(acceptRes.body.data.status).toBe("CONFIRMED");
      expect(acceptRes.body.data.ticketNumber).toMatch(/^MNS-/);
      expect(acceptRes.body.data.qrPayload).toBeDefined();

      // Step 4: Test Decline Flow on a second request
      const declineDate = "2026-12-15";
      const declineReqRes = await request(app)
        .post("/api/event-center-tickets")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          eventCenterId: reviewVenue._id,
          selectedDates: [{ date: declineDate }],
          bookingUnit: "day",
          duration: 1,
          totalPrice: { amount: 300000, currency: "NGN" },
          paymentMethod: "transfer",
        });

      const secondPendingBooking = declineReqRes.body.data;
      expect(secondPendingBooking.status).toBe("PENDING_REVIEW");

      const declineRes = await request(app)
        .post(`/api/event-center-tickets/${secondPendingBooking._id}/decline`)
        .set("Authorization", `Bearer ${venueHostToken}`)
        .send({ reason: "Venue undergoing scheduled maintenance" });

      expect(declineRes.status).toBe(200);
      expect(declineRes.body.data.status).toBe("CANCELLED");

      // Verify date block was released
      const updatedVenue = await EventCenter.findById(reviewVenue._id);
      const dateEntries = (updatedVenue.availability?.unavailableDates || []).filter(
        (d) => String(d.bookingId) === String(secondPendingBooking._id)
      );
      expect(dateEntries.length).toBe(0);
    });
  });
});
