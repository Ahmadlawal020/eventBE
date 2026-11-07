/**
 * Development-only fixture for a@a.com.
 * Preview: node scripts/seedAccountActivity.cjs
 * Apply:   node scripts/seedAccountActivity.cjs --apply
 * Deterministic IDs + an atomic receipt make reruns non-destructive.
 * Inserts validated documents directly: no payment, email, or push APIs run.
 */
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const Venue = require("../models/client/eventCenter.schema");
const Tier = require("../models/client/eventTicketType.schema");
const Order = require("../models/client/eventBooking.schema");
const Ticket = require("../models/client/userEventTicket.schema");
const Booking = require("../models/client/eventCenterBooking.schema");
const { generateQRPayload, verifyQRPayload } = require("../utils/qr");
const EMAIL = "a@a.com";
const COUNT = 1000;
const DAY = 86400000;
const NAMESPACE = "account-activity-v1:" + EMAIL;
const id = key => new mongoose.Types.ObjectId(crypto.createHash("sha256").update(NAMESPACE + ":" + key).digest("hex").slice(0, 24));
const number = (prefix, key) => {
  const hex = crypto.createHash("sha256").update(NAMESPACE + ":" + key).digest("hex").slice(0, 16).toUpperCase();
  return prefix + "-" + hex.slice(0, 8) + "-" + hex.slice(8);
};
const ids = { event: id("event"), day: id("day"), hour: id("hour"), tier: id("tier") };

async function build(owner, now) {
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const date = offset => new Date(+today + offset * DAY);
  const starts = new Date(+date(30) + 15 * 3600000);
  const ends = new Date(+starts + 6 * 3600000);
  const location = { countryCode: "NG", country: "Nigeria", city: "Lagos", area: "Victoria Island",
    street: "Demo Avenue", addressString: "Demo Avenue, Victoria Island, Lagos, Nigeria",
    coordinates: { latitude: 6.4281, longitude: 3.4219 } };
  const description = "Synthetic demo data for testing bookings, ticket sales, and dashboards.";
  const moderation = { status: "APPROVED", reason: "Development seed fixture", reviewedAt: now };
  const groups = new Map([[User, []], [Event, []], [Venue, []], [Tier, []], [Order, []], [Ticket, []], [Booking, []]]);
  const add = (Model, row) => {
    const doc = new Model(row);
    groups.get(Model).push(doc);
    return doc;
  };
  const password = await require("bcrypt").hash(crypto.randomBytes(48).toString("hex"), 10);
  for (let i = 0; i < 100; i++) add(User, {
    _id: id("buyer-" + i), firstName: "Demo", surname: "Customer " + String(i + 1).padStart(3, "0"),
    email: "munasaba-seed-" + String(owner._id) + "-" + i + "@example.test",
    password, dob: new Date("1995-01-01"), roles: ["user"], isActive: false,
    notificationPreferences: { channels: { push: false, email: false, sms: false } },
    createdAt: date(-900), updatedAt: now
  });
  add(Event, {
    _id: ids.event, title: "Demo Lagos Celebration", shortDescription: description, description,
    eventType: "MUSIC_CONCERTS", location, schedule: { from: starts, to: ends, timeZone: "Africa/Lagos" },
    capacity: 1500, entry: { ticketRequired: true }, status: "LISTED", moderation,
    createdBy: owner._id, performance: { ticketSales: COUNT, revenue: COUNT * 5000 },
    ticketGuide: { refundPolicyType: "NO_REFUNDS", platformPolicyAcknowledged: true, refundPolicy: "Demo tickets only." },
    arrivalGuide: { notes: "Development demo event.", checkInInstructions: "Present your ticket QR code." },
    createdAt: date(-60), updatedAt: now
  });
  add(Tier, {
    _id: ids.tier, eventId: ids.event, name: "General Admission", description,
    ticketType: "PAID", totalQuantity: 1500, soldQuantity: COUNT,
    salesStartAt: date(-60), salesEndAt: starts, currency: { code: "NGN", symbol: "\u20a6" },
    commission: { percentage: 0, type: "ADD_ON" }, price: { amountCents: 500000 },
    createdAt: date(-60), updatedAt: now
  });
  for (let i = 0; i < COUNT; i++) {
    const buyer = id("buyer-" + (i % 100));
    const createdAt = new Date(+now - (COUNT - 1 - i) * (59 * DAY / COUNT));
    const ticketNumber = number("MNB", "event-ticket-" + i);
    add(Order, {
      _id: id("order-" + i), eventId: ids.event, buyer,
      items: [{ ticketId: ids.tier, name: "General Admission", quantity: 1, pricePerUnit: 500000,
        totalPrice: 500000, subtotalAmount: 500000, feeAmount: 0, buyerFeeAmount: 0, organiserFeeAmount: 0, feeMode: "PASS_TO_BUYER" }],
      subtotalAmount: 500000, totalAmount: 500000, currency: "NGN",
      platformFeeAmount: 0, buyerFeeAmount: 0, organiserFeeAmount: 0, organiserPayoutAmount: 500000,
      fixedFeeAmount: 0, feePercentage: 0, feeMode: "PASS_TO_BUYER",
      paymentStatus: "COMPLETED", paymentMethod: "TRANSFER", paymentReference: "seed-" + id("order-" + i),
      status: "ACTIVE", inventoryReserved: true, createdAt, updatedAt: createdAt
    });
    add(Ticket, {
      _id: id("event-ticket-" + i), bookingId: id("order-" + i), eventId: ids.event,
      ticketTypeId: ids.tier, owner: buyer, ticketName: "General Admission", ticketNumber,
      qrPayload: generateQRPayload(ticketNumber, ids.event, "EVENT"), validSchedule: { from: starts, to: ends },
      eventSnapshot: { title: "Demo Lagos Celebration", shortDescription: description, eventType: "MUSIC_CONCERTS",
        organiser: { name: owner.firstName + " " + owner.surname, email: EMAIL }, location,
        schedule: { startDate: starts, endDate: ends } },
      ticketSnapshot: { name: "General Admission", description, ticketType: "PAID", price: { amount: 5000, currency: "NGN", symbol: "\u20a6" } },
      createdAt, updatedAt: createdAt
    });
  }
  for (const unit of ["day", "hour"]) {
    const price = unit === "day" ? 150000 : 15000;
    const venue = add(Venue, {
      _id: ids[unit], venueName: unit === "day" ? "Demo Daily Event Center" : "Demo Hourly Event Center",
      venueType: "MULTIPURPOSE_SPACE", shortDescription: description, description, location,
      capacity: { max: unit === "day" ? 500 : 100 }, status: "LISTED", moderation, createdBy: owner._id,
      bookingSettings: "INSTANT", basePrice: { amount: price, currency: "NGN", unit, feeMode: "addon", minDuration: 1 },
      availability: { minDuration: 1, maxDuration: unit === "day" ? 7 : 10, bookingWindow: 12,
        operationalHours: { open: "08:00", close: "18:00" } },
      checkIn: { isFlexible: false, start: "08:00", end: "18:00" }, checkOut: { time: "18:00" },
      performance: { bookings: COUNT, revenue: COUNT * price }, createdAt: date(-900), updatedAt: now
    });
    for (let i = 0; i < COUNT; i++) {
      const past = i < 800;
      const offset = unit === "day" ? (past ? i - 807 : i - 793) : (past ? Math.floor(i / 10) - 87 : Math.floor((i - 800) / 10) + 7);
      const slot = { date: date(offset) };
      if (unit === "hour") Object.assign(slot, { startTime: String(8 + i % 10).padStart(2, "0") + ":00", endTime: String(9 + i % 10).padStart(2, "0") + ":00" });
      const bookingId = id(unit + "-booking-" + i);
      const createdAt = past ? date(offset - 7) : new Date(+now - (COUNT - 1 - i) * (20 * DAY / 200));
      const ticketNumber = number("MNS", unit + "-" + i);
      add(Booking, {
        _id: bookingId, buyer: id("buyer-" + (i % 100)), organiser: owner._id, eventCenter: venue._id,
        selectedDates: [slot], bookingUnit: unit, duration: 1, bookingMode: "INSTANT",
        totalPrice: { amount: price, currency: "NGN" }, subtotalPrice: { amount: price, currency: "NGN" },
        platformFeeAmount: 0, buyerFeeAmount: 0, organiserFeeAmount: 0, organiserPayoutAmount: price,
        feePercentage: 0, feeMode: "PASS_TO_BUYER", paymentStatus: "COMPLETED",
        paymentReference: "seed-" + bookingId, status: past ? "COMPLETED" : "ACTIVE", inventoryReserved: true,
        cancellationPolicy: venue.cancellationPolicy.toObject(), ticketNumber,
        qrPayload: generateQRPayload(ticketNumber, venue._id, "EVENT_CENTER"), createdAt, updatedAt: createdAt
      });
      venue.availability[unit === "day" ? "unavailableDates" : "unavailableSlots"].push({
        ...slot, type: "BOOKED", bookingId: String(bookingId), bookingUnit: unit, pendingCheckout: false
      });
    }
  }
  for (const docs of groups.values()) for (const doc of docs) await doc.validate();
  for (const doc of [...groups.get(Ticket), ...groups.get(Booking)]) assert(verifyQRPayload(doc.qrPayload).valid);
  for (const venue of groups.get(Venue)) {
    const slots = venue.availability[venue.basePrice.unit === "day" ? "unavailableDates" : "unavailableSlots"];
    assert.equal(new Set(slots.map(s => s.date.toISOString() + (s.startTime || ""))).size, COUNT);
  }
  return groups;
}

async function verify(owner) {
  assert.equal(await User.countDocuments({ _id: { $in: Array.from({ length: 100 }, (_, i) => id("buyer-" + i)) } }), 100);
  assert.equal(await Event.countDocuments({ _id: ids.event, createdBy: owner._id }), 1);
  assert.equal(await Venue.countDocuments({ _id: { $in: [ids.day, ids.hour] }, createdBy: owner._id }), 2);
  assert.equal(await Order.countDocuments({ eventId: ids.event, paymentStatus: "COMPLETED" }), COUNT);
  const tickets = await Ticket.find({ eventId: ids.event }).lean();
  assert.equal(tickets.length, COUNT);
  assert.equal((await Tier.findById(ids.tier).lean()).soldQuantity, COUNT);
  const orders = await Order.find({ eventId: ids.event }).lean();
  const orderIds = new Set(orders.map(o => String(o._id)));
  assert(tickets.every(t => orderIds.has(String(t.bookingId)) && verifyQRPayload(t.qrPayload).valid));
  assert.equal(orders.reduce((sum, o) => sum + o.totalAmount, 0), COUNT * 500000);
  const venues = [];
  for (const unit of ["day", "hour"]) {
    const venue = await Venue.findById(ids[unit]).lean();
    assert.equal(venue.basePrice.unit, unit);
    const bookings = await Booking.find({ eventCenter: venue._id }).lean();
    assert.equal(bookings.length, COUNT);
    assert(bookings.every(b => b.bookingUnit === unit && b.paymentStatus === "COMPLETED" && verifyQRPayload(b.qrPayload).valid));
    const slots = venue.availability[unit === "day" ? "unavailableDates" : "unavailableSlots"];
    assert.equal(slots.length, COUNT);
    const bookingIds = new Set(bookings.map(b => String(b._id)));
    assert(slots.every(s => bookingIds.has(s.bookingId)));
    const revenue = bookings.reduce((sum, b) => sum + b.organiserPayoutAmount, 0);
    assert.equal(revenue, COUNT * venue.basePrice.amount);
    venues.push({ name: venue.venueName, unit, bookings: bookings.length, revenueNGN: revenue, id: String(venue._id) });
  }
  console.log(JSON.stringify({ verified: true, owner: EMAIL, event: { name: "Demo Lagos Celebration", bookings: COUNT, tickets: tickets.length, revenueNGN: COUNT * 5000, id: String(ids.event) }, venues }, null, 2));
}

async function main() {
  if (!["development", "dev", "test"].includes((process.env.NODE_ENV || "").toLowerCase())) throw Error("This seed requires an explicit development/test NODE_ENV.");
  await mongoose.connect(process.env.DATABASE_URI, { serverSelectionTimeoutMS: 15000 });
  const owner = await User.findOne({ email: EMAIL }).select("_id email firstName surname roles").lean();
  assert(owner, "The requested owner does not exist.");
  assert(owner.roles.includes("organiser"), "The requested owner must be an organiser.");
  const receipts = mongoose.connection.collection("development_seed_runs");
  if (await receipts.findOne({ _id: NAMESPACE })) {
    console.log("Seed already applied; verifying without adding records.");
    return verify(owner);
  }
  const now = new Date();
  const groups = await build(owner, now);
  console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "dry-run", database: mongoose.connection.name, owner: EMAIL,
    documents: Object.fromEntries([...groups].map(([Model, docs]) => [Model.collection.name, docs.length])) }, null, 2));
  for (const [Model, docs] of groups) assert.equal(await Model.countDocuments({ _id: { $in: docs.map(d => d._id) } }), 0, "Seed ID collision in " + Model.modelName);
  if (!process.argv.includes("--apply")) return;
  await mongoose.connection.transaction(async session => {
    await receipts.insertOne({ _id: NAMESPACE, owner: owner._id, createdAt: now, listings: ids }, { session });
    for (const [Model, docs] of groups) {
      // Validated above; raw insertion avoids save middleware and external side effects.
      await Model.collection.insertMany(docs.map(d => d.toObject({ virtuals: false })), { session, ordered: true });
    }
  });
  await verify(owner);
}
main().catch(error => {
  console.error("Seed failed:", error.name, error.code || "", error instanceof assert.AssertionError ? error.message : (error.name === "ValidationError" ? error.message : "No successful seed confirmation; inspect configuration/connection."));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());

