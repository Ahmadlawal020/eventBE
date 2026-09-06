jest.mock("../services/notification", () => ({
  dispatchNotification: jest.fn().mockResolvedValue({}),
  notifyTicketPurchased: jest.fn().mockResolvedValue({}),
  notifyVenueBookingRequest: jest.fn().mockResolvedValue({}),
  notifyVenueBookingInstant: jest.fn().mockResolvedValue({}),
}));
jest.mock("../services/payment", () => ({
  getPaymentGateway: () => ({
    name: "test", validateWebhookSignature: () => true,
    parseWebhookEvent: (body) => body, verifyPayment: jest.fn(),
  }),
}));
jest.mock("../controllers/client/userEventTicket.controller", () => ({
  createTicketsForBooking: jest.fn().mockResolvedValue([]),
}));
jest.mock("../controllers/client/bookingHistory.controller", () => ({
  logBookingHistory: jest.fn(),
}));
const mongoose = require("mongoose");
const request = require("supertest");
const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const EventBooking = require("../models/client/eventBooking.schema");
const VenueBooking = require("../models/client/eventCenterBooking.schema");
const Earning = require("../models/client/referralEarning.schema");
const Fees = require("../models/management/platformFees.schema");
const service = require("../services/referral.service");
const { ensureGlobalPolicy, savePolicy } = require("../services/referralPolicy.service");
const { previewAdjustment, applyAdjustment } = require("../services/referralAdjustment.service");
const { reconcileReferrals } = require("../services/referralReconciliation.service");
const { dispatchNotification, notifyTicketPurchased } = require("../services/notification");
const app = express();
app.use(express.json());
app.use("/referrals", require("../routes/client/referral.route"));
app.use("/auth", require("../routes/client/auth.route"));
app.use("/admin/referrals", require("../routes/management/referrals.route"));
app.post("/webhook", require("../controllers/client/paymentWebhook.controller").handlePaymentWebhook);
app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
const token = (user) => jwt.sign({ UserInfo: { id: String(user._id), email: user.email, roles: user.roles } }, process.env.ACCESS_TOKEN_SECRET);
const makeUser = (email, extra = {}) => User.create({
  firstName: "Test", surname: "Person", email, password: "Password123", dob: new Date("1990-01-01"), ...extra,
});
let referrer, host, buyer, event, venue;
beforeEach(async () => {
  referrer = await makeUser("referrer@example.com");
  host = await makeUser("host@example.com", { roles: ["organiser"], referredBy: referrer._id, referredAt: new Date(Date.now() - 1000) });
  buyer = await makeUser("buyer@example.com");
  event = await Event.create({ title: "Test Event", category: "Concerts", createdBy: host._id,
    schedule: { startDate: new Date(), endDate: new Date(Date.now() + 86400000) } });
  venue = await EventCenter.create({ venueName: "Test Venue", createdBy: host._id });
  await Fees.create({ key: "platform_fees", referralCommission: 5, referralDurationDays: 90 });
});
const ticket = (extra = {}) => EventBooking.create({
  eventId: event._id, buyer: buyer._id, items: [], totalAmount: 1000000,
  paymentMethod: "CARD", paymentStatus: "COMPLETED",
  paymentReference: "ticket-" + new mongoose.Types.ObjectId(), referralQualifiedAt: extra.createdAt || new Date(), ...extra,
});
const venueBooking = (extra = {}) => VenueBooking.create({
  eventCenter: venue._id, organiser: host._id, buyer: buyer._id, selectedDates: [],
  bookingUnit: "day", duration: 1, totalPrice: { amount: 10000, currency: "NGN" },
  paymentStatus: "COMPLETED", paymentReference: "venue-" + new mongoose.Types.ObjectId(), ...extra,
});
const recordTicket = (booking) => service.processReferralCommission({ bookingId: booking._id, sourceType: "EVENT_TICKET" });
const recordVenue = (booking) => service.processReferralCommission({ bookingId: booking._id, sourceType: "EVENT_CENTER_BOOKING" });

test("new local and Google accounts get distinct codes; legacy codes are preserved", async () => {
  const google = await makeUser("google@example.com", { authProvider: "google", googleId: "test-google" });
  expect(new Set([referrer.referralCode, host.referralCode, buyer.referralCode, google.referralCode]).size).toBe(4);
  await User.updateOne({ _id: referrer._id }, { $set: { referralCode: "MNLEGACY" } });
  expect(await service.ensureUserReferralCode(referrer._id)).toBe("MNLEGACY");
});
test("concurrent requests backfill one stable code for an old account", async () => {
  await User.updateOne({ _id: buyer._id }, { $unset: { referralCode: "" } });
  const codes = await Promise.all(Array.from({ length: 12 }, () => service.ensureUserReferralCode(buyer._id)));
  expect(new Set(codes).size).toBe(1);
  expect(codes[0]).toBe((await User.findById(buyer._id)).referralCode);
});
test("signup accepts and saves a normalized referral; rejects invalid codes", async () => {
  const payload = { firstName: "New", surname: "User", email: "signup@example.com",
    password: "Password123", dob: "1990-01-01", authProvider: "local", referralCode: " " + referrer.referralCode.toLowerCase() + " " };
  const response = await request(app).post("/auth/signup").send(payload);
  expect(response.status).toBe(201);
  const signedUp = await User.findOne({ email: payload.email });
  expect(String(signedUp.referredBy)).toBe(String(referrer._id));
  expect(signedUp.referralCode).not.toBe(referrer.referralCode);
  const bad = await request(app).post("/auth/signup").send({ ...payload, email: "bad@example.com", referralCode: "INVALID" });
  expect(bad.status).toBe(400);
  expect(await User.findOne({ email: "bad@example.com" })).toBeNull();
});
test("self, invalid and inactive referrals fail, and competing applications cannot overwrite attribution", async () => {
  await expect(service.applyReferralCode(buyer._id, buyer.referralCode)).rejects.toThrow("own");
  await expect(service.applyReferralCode(buyer._id, "INVALID")).rejects.toThrow("Invalid");
  await expect(service.applyReferralCode(buyer._id, "  ")).rejects.toThrow("required");
  await User.updateOne({ _id: host._id }, { $set: { isActive: false } });
  await expect(service.applyReferralCode(buyer._id, host.referralCode)).rejects.toThrow("Invalid");
  await User.updateOne({ _id: host._id }, { $set: { isActive: true } });
  const results = await Promise.allSettled([
    service.applyReferralCode(buyer._id, referrer.referralCode.toLowerCase()),
    service.applyReferralCode(buyer._id, host.referralCode),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await User.findById(buyer._id)).referredAt).toBeTruthy();
});
test("concurrent duplicate confirmations credit exactly one ticket earning in naira", async () => {
  const booking = await ticket();
  await Promise.all(Array.from({ length: 12 }, () => recordTicket(booking)));
  expect(await Earning.countDocuments()).toBe(1);
  const earning = await Earning.findOne();
  expect(earning.totalAmount).toBe(10000);
  expect(earning.commissionAmount).toBe(500);
  expect((await service.getReferralStats(referrer._id)).stats.totalEarned).toBe(500);
});
test("commission uses persisted amount and listing owner, not caller-supplied values", async () => {
  const booking = await ticket();
  const earning = await service.processReferralCommission({
    sourceType: "EVENT_TICKET", bookingId: booking._id, organiserId: buyer._id, totalAmount: 999999999,
  });
  expect(String(earning.referredUser)).toBe(String(host._id));
  expect(earning.commissionAmount).toBe(500);
});
test("venue amounts are naira, and review bookings need payment and acceptance", async () => {
  const booking = await venueBooking({ bookingMode: "REVIEW", status: "PENDING_REVIEW" });
  expect(await recordVenue(booking)).toBeNull();
  await VenueBooking.updateOne({ _id: booking._id }, { $set: { status: "CONFIRMED", paymentStatus: "PENDING" } });
  expect(await recordVenue(booking)).toBeNull();
  await VenueBooking.updateOne({ _id: booking._id }, { $set: { paymentStatus: "COMPLETED" } });
  expect((await recordVenue(booking)).commissionAmount).toBe(500);
});
test.each([
  { paymentStatus: "PENDING" }, { paymentStatus: "FAILED" }, { paymentStatus: "REFUNDED" },
  { status: "CANCELLED" }, { totalAmount: 0 }, { totalAmount: -100 }, { currency: "USD" },
])("ineligible ticket earns nothing: %j", async (extra) => {
  expect(await recordTicket(await ticket(extra))).toBeNull();
  expect(await Earning.countDocuments()).toBe(0);
});
test("disabled program and inactive referrers do not earn", async () => {
  const booking = await ticket();
  await Fees.updateOne({}, { $set: { referralProgramEnabled: false } });
  expect(await recordTicket(booking)).toBeNull();
  await savePolicy("GLOBAL", { expectedVersion: 1, action: "RESUME" }, referrer._id);
  await User.updateOne({ _id: referrer._id }, { $set: { isActive: false } });
  expect(await recordTicket(booking)).toBeNull();
});
test("sale-time eligibility survives delayed processing, excludes old sales, and supports a longer configured period", async () => {
  const now = Date.now();
  await User.updateOne({ _id: host._id }, { $set: { referredAt: new Date(now - 100 * 86400000) } });
  const eligible = await ticket({ createdAt: new Date(now - 20 * 86400000) });
  expect((await recordTicket(eligible)).commissionAmount).toBe(500);
  expect(await recordTicket(await ticket())).toBeNull();
  await savePolicy("GLOBAL", { expectedVersion: 1, duration: { value: 6, unit: "MONTHS" } }, referrer._id);
  expect((await recordTicket(await ticket())).commissionAmount).toBe(500);
  await User.updateOne({ _id: host._id }, { $set: { referredAt: new Date(Date.now() + 86400000) } });
  expect(await recordTicket(await ticket())).toBeNull();
});
test("refund reconciliation removes credit from totals and keeps an audit record", async () => {
  const booking = await ticket();
  await recordTicket(booking);
  await EventBooking.updateOne({ _id: booking._id }, { $set: { paymentStatus: "REFUNDED" } });
  await recordTicket(booking);
  const stats = await service.getReferralStats(referrer._id);
  expect(stats.stats.totalEarned).toBe(0);
  expect(stats.stats.totalTransactions).toBe(0);
  expect(stats.recentTransactions[0].status).toBe("REFUNDED");
});
test("legacy unpaid rewards leave completed totals until payment is confirmed", async () => {
  const booking = await venueBooking();
  await recordVenue(booking);
  await VenueBooking.updateOne({ _id: booking._id }, { $set: { paymentStatus: "PENDING" } });
  await recordVenue(booking);
  expect((await service.getReferralStats(referrer._id)).stats.totalEarned).toBe(0);
  expect((await Earning.findOne()).status).toBe("PENDING");
  await VenueBooking.updateOne({ _id: booking._id }, { $set: { paymentStatus: "COMPLETED" } });
  await recordVenue(booking);
  expect((await service.getReferralStats(referrer._id)).stats.totalEarned).toBe(500);
});

test("notification failure cannot lose an earning", async () => {
  dispatchNotification.mockRejectedValueOnce(new Error("notification offline"));
  await recordTicket(await ticket());
  expect(await Earning.countDocuments()).toBe(1);
});
test("reconciliation recovers a failed ledger write and backfills old users", async () => {
  const booking = await ticket();
  const create = jest.spyOn(Earning, "create").mockRejectedValueOnce(new Error("database interrupted"));
  expect(await service.recordBookingReferral(booking._id, "EVENT_TICKET")).toBeNull();
  create.mockRestore();
  await User.updateOne({ _id: buyer._id }, { $unset: { referralCode: "" } });
  // A scan may wrap after the checkpoint from another invocation.
  await reconcileReferrals();
  await reconcileReferrals();
  expect(await Earning.countDocuments()).toBe(1);
  expect((await User.findById(buyer._id)).referralCode).toBeTruthy();
});
test("completed webhook retries repair missing earnings and do not duplicate them", async () => {
  const booking = await ticket();
  const body = { event: "charge.success", status: "success", reference: booking.paymentReference, metadata: { type: "EVENT_TICKET" } };
  expect((await request(app).post("/webhook").send(body)).status).toBe(200);
  expect((await request(app).post("/webhook").send(body)).status).toBe(200);
  expect(await Earning.countDocuments()).toBe(1);
});
test("new ticket webhook records earnings even when purchase notification fails", async () => {
  notifyTicketPurchased.mockRejectedValueOnce(new Error("offline"));
  const body = { event: "charge.success", status: "success", reference: "new-webhook", metadata: {
    type: "EVENT_TICKET", eventId: String(event._id), buyerId: String(buyer._id), items: [], totalAmount: 1000000,
  }};
  expect((await request(app).post("/webhook").send(body)).status).toBe(200);
  expect((await Earning.findOne()).commissionAmount).toBe(500);
});
test("API stats are authenticated and account-specific, with ledger-only totals", async () => {
  await recordTicket(await ticket());
  await User.updateOne({ _id: buyer._id }, { $set: { referralEarnings: 99999 } });
  expect((await request(app).get("/referrals/stats")).status).toBe(401);
  const own = await request(app).get("/referrals/stats").auth(token(referrer), { type: "bearer" });
  const other = await request(app).get("/referrals/stats").auth(token(buyer), { type: "bearer" });
  expect(own.body.data.stats.totalEarned).toBe(500);
  expect(other.body.data.stats.totalEarned).toBe(0);
  expect(other.body.data.referralCode).not.toBe(own.body.data.referralCode);
});

test("code-entry deadline is configurable and enforced for existing accounts", async () => {
  await User.collection.updateOne({_id:buyer._id},{$set:{createdAt:new Date(Date.now()-21*86400000)}});
  await expect(service.applyReferralCode(buyer._id,referrer.referralCode)).rejects.toThrow("expired");
  await savePolicy("GLOBAL",{expectedVersion:1,entryWindow:{value:4,unit:"WEEKS"}},referrer._id);
  await service.applyReferralCode(buyer._id,referrer.referralCode);
  expect(String((await User.findById(buyer._id)).referredBy)).toBe(String(referrer._id));
});
test("delayed commission recording uses the earlier policy rate", async () => {
  await ensureGlobalPolicy();
  const oldBooking=await ticket();
  const policy=await savePolicy("GLOBAL",{expectedVersion:1,commissionPercentage:12},referrer._id);
  expect((await recordTicket(oldBooking)).commissionAmount).toBe(500);
  const future=await ticket({referralQualifiedAt:new Date(new Date(policy.revisions.at(-1).effectiveAt).getTime()+1)});
  expect((await recordTicket(future)).commissionAmount).toBe(1200);
  expect((await recordTicket(oldBooking)).commissionAmount).toBe(500);
});
test("a delayed webhook retains the provider payment date across a rate change", async () => {
  await ensureGlobalPolicy();
  const paidAt=new Date();
  await savePolicy("GLOBAL",{expectedVersion:1,commissionPercentage:18},referrer._id);
  const response=await request(app).post("/webhook").send({event:"charge.success",status:"success",reference:"delayed-provider",paidAt,
    metadata:{type:"EVENT_TICKET",eventId:String(event._id),buyerId:String(buyer._id),items:[],totalAmount:1000000}});
  expect(response.status).toBe(200);
  expect((await Earning.findOne()).commissionAmount).toBe(500);
});
test("group and individual settings work and global pause gates them", async () => {
  await ensureGlobalPolicy();
  const key="GROUP:"+new mongoose.Types.ObjectId();
  await savePolicy(key,{expectedVersion:0,name:"Partners",userIds:[String(referrer._id)],priority:10,commissionPercentage:8},referrer._id);
  expect((await recordTicket(await ticket())).commissionAmount).toBe(800);
  await savePolicy("USER:"+referrer._id,{expectedVersion:0,commissionPercentage:11,action:"START"},referrer._id);
  expect((await recordTicket(await ticket())).commissionAmount).toBe(1100);
  await savePolicy("GLOBAL",{expectedVersion:1,action:"PAUSE"},referrer._id);
  const paused=await ticket();
  expect(await recordTicket(paused)).toBeNull();
  await savePolicy("GLOBAL",{expectedVersion:2,action:"RESUME"},referrer._id);
  expect(await recordTicket(paused)).toBeNull();
  expect((await recordTicket(await ticket())).commissionAmount).toBe(1100);
});
test("concurrent admin edits cannot silently overwrite one another", async () => {
  await ensureGlobalPolicy();
  const results=await Promise.allSettled([savePolicy("GLOBAL",{expectedVersion:1,commissionPercentage:7},referrer._id),
    savePolicy("GLOBAL",{expectedVersion:1,commissionPercentage:9},referrer._id)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.find(r=>r.status==="rejected").reason.status).toBe(409);
});
test("past rate changes require preview and confirmation and are idempotent", async () => {
  await recordTicket(await ticket());
  const preview=await previewAdjustment({scopeKey:"GLOBAL",from:"2000-01-01",to:"2100-01-01",rate:10,reason:"Approved correction"},referrer._id);
  expect(preview.count).toBe(1);
  expect((await Earning.findOne()).commissionAmount).toBe(500);
  await expect(applyAdjustment(preview.id,referrer._id,false)).rejects.toThrow("confirmation");
  await applyAdjustment(preview.id,referrer._id,true);
  await applyAdjustment(preview.id,referrer._id,true);
  const earning=await Earning.findOne();
  expect(earning.commissionAmount).toBe(1000);
  expect(earning.adjustments).toHaveLength(1);
});
test("retroactive preview does not overwrite a subsequent refund", async () => {
  const booking=await ticket(); await recordTicket(booking);
  const preview=await previewAdjustment({scopeKey:"GLOBAL",from:"2000-01-01",to:"2100-01-01",rate:10,reason:"Correction"},referrer._id);
  await EventBooking.updateOne({_id:booking._id},{$set:{paymentStatus:"REFUNDED"}});
  await recordTicket(booking);
  expect((await applyAdjustment(preview.id,referrer._id,true)).status).toBe("PARTIAL");
  expect((await Earning.findOne()).commissionAmount).toBe(500);
});
test("policy APIs reject ordinary users and invalid admin settings", async () => {
  expect((await request(app).get("/admin/referrals/policies").auth(token(buyer),{type:"bearer"})).status).toBe(403);
  const adminToken=jwt.sign({UserInfo:{id:String(referrer._id),roles:["finance_admin"]}},process.env.ACCESS_TOKEN_SECRET);
  const invalid=await request(app).put("/admin/referrals/policies/GLOBAL").auth(adminToken,{type:"bearer"})
    .send({expectedVersion:1,commissionPercentage:101});
  expect(invalid.status).toBe(400);
  const valid=await request(app).put("/admin/referrals/policies/GLOBAL").auth(adminToken,{type:"bearer"})
    .send({expectedVersion:1,entryWindow:{value:3,unit:"WEEKS"},duration:{value:2,unit:"MONTHS"}});
  expect(valid.status).toBe(200);
  expect(valid.body.data.revisions.at(-1).duration.unit).toBe("MONTHS");
});

