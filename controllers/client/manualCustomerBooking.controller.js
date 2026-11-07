const mongoose = require("mongoose"), crypto = require("crypto");
const Operations = require("../../models/client/bookingOperations.schema"), Venue = require("../../models/client/eventCenter.schema");
const { fail } = require("../../services/venueAccess.service");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const handle = fn => async (req,res) => { try { await fn(req,res); } catch(e) { const status = e.status || e.statusCode || (e.code === 11000 ? 409 : e.name === "CastError" ? 400 : 500); res.status(status).json({ message: status === 500 ? "Could not update the manual booking." : e.code === 11000 ? "This booking is already linked or changed. Refresh before trying again." : e.message }); } };
exports.invite = handle(async (req,res) => {
  const v = await Venue.findById(req.params.venueId).lean();
  if (!v || String(v.createdBy) !== String(req.user.id)) throw fail(403,"Only the venue owner can link a customer.");
  const b = await require("../../services/bookingAttendance.service").loadBooking(v._id, req.params.bookingId);
  if (b.bookingType !== "MANUAL") throw fail(400,"Only manual bookings can be linked.");
  const token = crypto.randomBytes(24).toString("hex");
  const record = await Operations.findOneAndUpdate({ _id: `${v._id}:${b._id}`, customerId: null }, {
    $inc: { revision: 1 },
    $set: { claimHash: hash(token), claimExpiresAt: new Date(Date.now() + 7 * 86400000) },
    $setOnInsert: { eventCenter: v._id, bookingId: String(b._id), bookingSnapshot: { bookingUnit: b.bookingUnit, dates: b.selectedDates, totalPrice: b.totalPrice, guestName: b.guestName, createdAt: b.createdAt }, openingPaidMinor: require("../../services/bookingOperations.service").paymentSummary(b).paidMinor },
  }, { new: true, upsert: true });
  if (!record) throw fail(409,"Customer already linked.");
  res.json({ data: { token, expiresAt: record.claimExpiresAt } });
});
exports.claim = handle(async (req,res) => {
  if (typeof req.body.token !== "string" || !/^[a-f0-9]{48}$/.test(req.body.token.trim())) throw fail(400,"Enter the booking code shared by the organiser.");
  const record = await Operations.findOneAndUpdate({ claimHash: hash(req.body.token.trim()), claimExpiresAt: { $gt: new Date() }, customerId: null }, {
    $set: { customerId: req.user.id }, $unset: { claimHash: 1, claimExpiresAt: 1 }, $inc: { revision: 1 },
    $push: { audit: { action: "CUSTOMER_LINKED", actor: req.user.id, at: new Date(), reason: "Customer accepted the organiser's booking code" } },
  }, { new: true });
  if (!record) throw fail(409,"Code expired or already used. Ask the organiser for a new code.");
  res.json({ data: { bookingId: record.bookingId } });
});
exports.mine = handle(async (req,res) => {
  const records = await Operations.find({ customerId: req.user.id }).lean();
  const venues = await Venue.find({ _id: { $in: records.map(r => r.eventCenter) } }).lean();
  const bookings = await require("../../services/manualBookingRead.service").getManualBookings(venues);
  res.json({ data: records.map(record => {
    const b = bookings.find(b => String(b.eventCenter._id) === String(record.eventCenter) && b.bookingId === record.bookingId);
    if (!b) return null;
    return { bookingId: b.bookingId, venueId: String(record.eventCenter), venueName: b.eventCenter.venueName,
      status: b.status, dates: b.selectedDates, summary: require("../../services/bookingOperations.service").paymentSummary(b,record),
      eventPurpose: record.eventPurpose, refunds: (record.refunds || []).map(f => ({ id: f.id, amountMinor: f.amountMinor, status: f.status, sentAt: f.sentAt, confirmedAt: f.confirmedAt })),
      payments: (record.payments || []).map(p => ({ id: p.id, kind: p.kind, amountMinor: p.amountMinor, at: p.at, reference: p.reference })) };
  }).filter(Boolean) });
});
exports.confirmRefund = handle(async (req,res) => {
  const record = await Operations.findOne({ _id: `${req.params.venueId}:${req.params.bookingId}`, customerId: req.user.id }).lean();
  if (!record) throw fail(404,"Linked booking not found.");
  const booking = await require("../../services/bookingAttendance.service").loadBooking(record.eventCenter,record.bookingId);
  await require("../../services/bookingOperations.service").saveOperation(record.eventCenter,booking,{ action: "REFUND_CONFIRM", refundId: req.body.refundId, expectedRevision: record.revision },req.user.id);
  res.json({ success: true });
});
