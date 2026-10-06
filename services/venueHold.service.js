const mongoose = require("mongoose");
const Hold = require("../models/client/venueHold.schema");
const Venue = require("../models/client/eventCenter.schema");
const { assertVenueSchedule } = require("./venueBookingRules.service");
const { bookingSessions } = require("./bookingAttendance.service");
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
async function createHold(venueId, payload, actor) {
  const duration = Number(payload.hours);
  if (!Number.isFinite(duration) || duration < 1 || duration > 168) fail(400, "Hold duration must be between 1 and 168 hours.");
  if (typeof payload.clientName !== "string" || !payload.clientName.trim() || payload.clientName.length > 150) fail(400, "Enter the client's name.");
  if (!Array.isArray(payload.dates) || !payload.dates.length || payload.dates.length > 90) fail(400, "Choose between 1 and 90 dates.");
  return mongoose.connection.transaction(async session => {
    const venue = await Venue.findById(venueId).session(session);
    if (!venue) fail(404, "Venue not found.");
    if (!payload.expectedUpdatedAt || new Date(payload.expectedUpdatedAt).getTime() !== new Date(venue.updatedAt).getTime()) fail(409, "The calendar changed. Refresh before creating a hold.");
    const unit = venue.basePrice?.unit === "hour" ? "hour" : "day";
    for (const date of payload.dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.date || "") || (Number.isNaN(new Date(date.date).getTime()) || new Date(date.date).toISOString().slice(0, 10) !== date.date)) fail(400, "Use valid YYYY-MM-DD dates.");
      if (unit === "hour" && (!date.startTime || !date.endTime)) fail(400, "Start and end times are required.");
      if (!bookingSessions({ selectedDates: [date], bookingUnit: unit }).length) fail(400, "Invalid booking time range.");
    }
    assertVenueSchedule(venue, payload.dates, unit);
    const expiresAt = new Date(Date.now() + duration * 3600000);
    const firstSession = bookingSessions({ selectedDates: payload.dates, bookingUnit: unit })[0];
    if (expiresAt >= new Date(firstSession.endsAt)) fail(400, "The hold must expire before the first session ends.");
    const hold = (await Hold.create([{ eventCenter: venueId, createdBy: actor, clientName: payload.clientName.trim(),
      clientEmail: String(payload.clientEmail || "").slice(0, 200), clientPhone: String(payload.clientPhone || "").slice(0, 50),
      bookingUnit: unit, dates: payload.dates, expiresAt }], { session }))[0];
    const field = unit === "hour" ? "unavailableSlots" : "unavailableDates";
    const entries = hold.dates.map(d => ({ date: d.date, ...(unit === "hour" ? { startTime: d.startTime, endTime: d.endTime } : {}),
      type: "BLOCKED", holdId: String(hold._id), holdExpiresAt: expiresAt, clientName: hold.clientName }));
    await Venue.updateOne({ _id: venueId }, { $push: { [`availability.${field}`]: { $each: entries } } }, { session });
    return hold;
  });
}
async function resolveHold(venueId, id, action, actor, totalPrice) {
  if (!["CONFIRM", "RELEASE", "EXPIRE"].includes(action)) fail(400, "Invalid hold action.");
  return mongoose.connection.transaction(async session => {
    const hold = await Hold.findOne({ _id: id, eventCenter: venueId }).session(session);
    if (!hold) fail(404, "Hold not found.");
    if (hold.status !== "ACTIVE") fail(409, "This hold has already been resolved.");
    if (action === "CONFIRM" && hold.expiresAt <= new Date()) fail(409, "This hold has expired.");
    if (action === "EXPIRE" && hold.expiresAt > new Date()) return null;
    const venue = await Venue.findById(venueId).session(session);
    if (!venue) fail(404, "Venue not found.");
    for (const field of ["unavailableDates", "unavailableSlots"]) venue.availability[field] = (venue.availability[field] || []).filter(entry => entry.holdId !== String(hold._id));
    if (action === "CONFIRM") {
      if (!Number.isFinite(totalPrice) || totalPrice <= 0) fail(400, "Enter the agreed booking price.");
      assertVenueSchedule(venue, hold.dates, hold.bookingUnit, { checkTiming: false });
      hold.bookingId = `manual-hold-${hold._id}`;
      const field = hold.bookingUnit === "hour" ? "unavailableSlots" : "unavailableDates";
      venue.availability[field].push(...hold.dates.map(d => ({ date: d.date,
        ...(hold.bookingUnit === "hour" ? { startTime: d.startTime, endTime: d.endTime } : {}),
        type: "MANUAL", bookingId: hold.bookingId, clientName: hold.clientName, clientPhone: hold.clientPhone, clientEmail: hold.clientEmail, totalPrice, depositAmount: 0, paymentStatus: "pending" })));
      await require("../models/client/bookingHistory.schema").create([{ eventCenter: venueId, bookingId: hold.bookingId, bookingType: "MANUAL", bookingUnit: hold.bookingUnit,
        action: "CREATED", performedBy: actor, dates: hold.dates, guestName: hold.clientName, reason: "Temporary hold confirmed", totalPrice: { amount: totalPrice, currency: venue.basePrice?.currency || "NGN" } }], { session });
    }
    hold.status = action === "CONFIRM" ? "CONVERTED" : action === "EXPIRE" ? "EXPIRED" : "RELEASED";
    hold.resolvedBy = actor; hold.resolvedAt = new Date();
    await venue.save({ session }); await hold.save({ session }); return hold;
  });
}
module.exports = { createHold, resolveHold };
