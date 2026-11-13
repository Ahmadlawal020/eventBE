const mongoose = require("mongoose");
const Venue = require("../models/client/eventCenter.schema");
const Operations = require("../models/client/bookingOperations.schema");
const History = require("../models/client/bookingHistory.schema");
const { hasVenuePermission, fail } = require("./venueAccess.service");
const { bookingSessions, dayOf } = require("./bookingAttendance.service");
const { assertVenueSchedule, lastBookableDay } = require("./venueBookingRules.service");
const fields = ["unavailableDates", "unavailableSlots"];
const entries = venue => fields.flatMap(field => venue.availability?.[field] || []);
function groups(venue) {
  const result = new Map();
  for (const entry of entries(venue)) if (entry.type === "MANUAL") {
    if (!/^manual-[a-zA-Z0-9_-]{1,100}$/.test(entry.bookingId || "")) throw fail(400, "A valid manual booking reference is required.");
    if (!result.has(entry.bookingId)) result.set(entry.bookingId, []);
    result.get(entry.bookingId).push(entry);
  }
  return result;
}
const datesOf = (rows, unit) => bookingSessions({ selectedDates: rows, bookingUnit: unit }).map(s => ({ date: s.date, ...(unit === "hour" ? { startTime: s.startTime, endTime: s.endTime } : {}) }));
function validateManualSchedule(venue, rows, unit, id, now = new Date()) {
  const dates = datesOf(rows, unit);
  if (!dates.length || rows.some(row => !bookingSessions({ selectedDates: [row], bookingUnit: unit }).length)) throw fail(400, "Choose valid booking dates and times.");
  assertVenueSchedule(venue, dates, unit, { bookingId: id, now });
  let duration = 0;
  for (const s of bookingSessions({ selectedDates: dates, bookingUnit: unit })) {
    if (unit === "hour") {
      const minutes = time => time === "00:00" || time === "24:00" ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      const start = Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3)), end = minutes(s.endTime);
      const open = venue.availability?.operationalHours?.open || "00:00", close = venue.availability?.operationalHours?.close || "24:00";
      if (start < Number(open.slice(0, 2)) * 60 + Number(open.slice(3)) || end > minutes(close)) throw fail(400, "Selected time is outside venue operating hours.");
      const hours = (end - start) / 60;
      if (hours < require("./venuePricingRules.service").minimumDuration(venue, s.date)) throw fail(400, "Selected hours are below the venue minimum.");
      duration += hours;
    } else duration++;
  }
  if (duration < (venue.availability?.minDuration || 1) || duration > (venue.availability?.maxDuration || 365)) throw fail(400, "Booking duration is outside the venue limits.");
  return dates;
}
async function validateManualBookingWindow(dates) {
  const settings = await require("./eventCenterSettings.service").getEventCenterSettings();
  const horizon = settings.booking.maximumBookingDate || lastBookableDay(dayOf(new Date()), settings.booking.maximumBookingWindowMonths || 12);
  if (dates.some(d => dayOf(d.date) > horizon)) throw fail(400, "Dates exceed the platform booking window.");
}
function openingMoney(entry) {
  const total = entry.totalPrice, deposit = entry.depositAmount || 0;
  if (!Number.isFinite(total) || total <= 0 || !Number.isSafeInteger(Math.round(total * 100)) || !Number.isFinite(deposit) || deposit < 0 || deposit > total) throw fail(400, "Enter a positive agreed price and a deposit between zero and that price.");
  if (!["pending", "partially_paid", "paid"].includes(entry.paymentStatus || "pending")) throw fail(400, "Invalid payment status.");
  if (entry.paymentStatus === "pending" && deposit !== 0) throw fail(400, "An unpaid booking cannot include a deposit.");
  if (entry.paymentStatus === "partially_paid" && (deposit <= 0 || deposit >= total)) throw fail(400, "A partial payment must be greater than zero and below the agreed price.");
  return Math.round((entry.paymentStatus === "paid" ? total : deposit) * 100);
}
async function syncManualBookings(previous, candidate, actor, session) {
  const oldGroups = groups(previous), nextGroups = groups(candidate);
  const canFinance = await hasVenuePermission(actor, previous, ["VIEW_FINANCES"]);
  const settings = await require("./eventCenterSettings.service").getEventCenterSettings();
  const horizon = settings.booking.maximumBookingDate || lastBookableDay(dayOf(new Date()), settings.booking.maximumBookingWindowMonths || 12);
  for (const id of new Set([...oldGroups.keys(), ...nextGroups.keys()])) {
    const oldRows = oldGroups.get(id), rows = nextGroups.get(id), first = (rows || oldRows)[0];
    let record = await Operations.findById(`${previous._id}:${id}`).session(session).lean();
    if (!oldRows && record) throw fail(409, "This booking reference already exists. Refresh and create a new booking.");
    const created = await History.findOne({ eventCenter: previous._id, bookingId: id, action: "CREATED", bookingType: "MANUAL" }).session(session).lean();
    const snapshot = record?.bookingSnapshot;
    const unit = snapshot?.bookingUnit || created?.bookingUnit || ((oldRows || rows).some(e => e.startTime) ? "hour" : previous.basePrice?.unit === "hour" ? "hour" : "day");
    const currency = snapshot?.totalPrice?.currency || created?.totalPrice?.currency || previous.basePrice?.currency || "NGN";
    const oldDates = oldRows ? datesOf(oldRows, unit) : [];
    const dates = rows ? datesOf(rows, unit) : oldDates;
    const moved = Boolean(oldRows && rows && JSON.stringify(dates) !== JSON.stringify(oldDates));
    if (oldRows && (!rows || moved) && bookingSessions({ selectedDates: oldDates, bookingUnit: unit }).some(s => new Date(s.startsAt) <= new Date())) throw fail(409, "Started bookings cannot be cancelled or rescheduled. Use attendance and handover to complete them.");
    const opening = record?.openingPaidMinor ?? openingMoney((oldRows || rows)[0]);
    if (rows) {
      const incomingPaid = openingMoney(first);
      for (const row of rows) if (row.totalPrice !== first.totalPrice || openingMoney(row) !== incomingPaid || row.clientName !== first.clientName || (row.clientEmail || "") !== (first.clientEmail || "") || (row.clientPhone || "") !== (first.clientPhone || "")) throw fail(400, "All dates of a booking must use the same guest and financial details.");
      const expectedPaid = record ? require("./bookingOperations.service").paymentSummary({ totalPrice: { amount: first.totalPrice } }, record).paidMinor : opening;
      if ((!oldRows && incomingPaid > 0 || oldRows && incomingPaid !== expectedPaid) && !canFinance) throw fail(403, "Finance access is required to record collections.");
      if (oldRows && incomingPaid !== expectedPaid) throw fail(409, "Record payments and refunds in booking payments, not by editing the calendar.");
      if (oldRows && first.totalPrice !== oldRows[0].totalPrice && !canFinance) throw fail(403, "Finance access is required to change the agreed price.");
      if (Math.round(first.totalPrice * 100) < expectedPaid) throw fail(400, "The agreed price cannot be below recorded collections.");
      if (!oldRows || moved) {
        validateManualSchedule(candidate, rows, unit, id);
        if (dates.some(d => d.date > horizon)) throw fail(400, "Dates exceed the platform booking window.");
      }
      for (const row of rows) { row.bookingUnit = unit; row.currency = currency; }
    }
    const bookingSnapshot = { ...(snapshot || {}), bookingUnit: unit, dates,
      guestName: first.clientName, guestDetails: { fullName: first.clientName, email: first.clientEmail || "", phoneNumber: first.clientPhone || "" },
      totalPrice: { amount: first.totalPrice, currency }, cancellationPolicy: snapshot?.cancellationPolicy || previous.cancellationPolicy || {},
      createdAt: snapshot?.createdAt || created?.createdAt || new Date() };
    await Operations.updateOne({ _id: `${previous._id}:${id}` }, { $set: { bookingSnapshot }, $setOnInsert: {
      eventCenter: previous._id, bookingId: id, openingPaidMinor: opening, revision: 0, payments: [], handovers: [], audit: [],
    } }, { upsert: true, session });
    if (!oldRows && rows) await require("./manualBookingEmail.service").queueBookingCode({
      venue: previous, bookingId: id, email: first.clientEmail, name: first.clientName,
    }, session);
    const changed = oldRows && rows && (first.totalPrice !== oldRows[0].totalPrice || first.clientName !== oldRows[0].clientName || first.clientEmail !== oldRows[0].clientEmail || first.clientPhone !== oldRows[0].clientPhone);
    const action = !rows ? "CANCELLED" : !oldRows ? "CREATED" : moved ? "RESCHEDULED" : changed ? "UPDATED" : null;
    if (action) {
      const [history] = await History.create([{ eventCenter: previous._id, bookingId: id, bookingType: "MANUAL", bookingUnit: unit,
        action, performedBy: actor, dates, previousDates: moved ? oldDates : [], guestName: first.clientName, guestDetails: bookingSnapshot.guestDetails,
        totalPrice: bookingSnapshot.totalPrice }], { session });
      const recipients = [...new Set([String(previous.createdBy), ...(record?.customerId ? [String(record.customerId)] : [])])];
      await require("./eventCenterRefundNotifications.service").queueNotices(recipients.map(recipient => ({ key: `manual:${history._id}:${recipient}`, recipient,
        type: "SYSTEM", title: "Venue booking " + action.toLowerCase(), message: `${previous.venueName || "Venue"}: booking ${id} was ${action.toLowerCase()}.`,
        data: { screen: recipient === String(previous.createdBy) ? "VenueBookingOperations" : "ManualVenueBooking", venueId: String(previous._id), bookingId: id },
      })), session);
    }
  }
}
async function commitVenueUpdate(id, patch, expectedUpdatedAt, actor) {
  return mongoose.connection.transaction(async session => {
    const previous = await Venue.findById(id).session(session).lean();
    if (!previous || +new Date(previous.updatedAt) !== +new Date(expectedUpdatedAt)) throw fail(409, "The venue changed. Refresh and try again.");
    const candidate = { ...previous, ...patch };
    if (patch.images) await require("./venueMedia.service").attachVenueMedia(patch.images, previous, id, actor, session);
    if (patch.availability || patch.basePrice) {
      candidate.availability = { ...previous.availability, ...(patch.availability || {}) };
      await syncManualBookings(previous, candidate, actor, session);
      patch = { ...patch, availability: candidate.availability };
    }
    const updated = await Venue.findOneAndUpdate({ _id: id, updatedAt: previous.updatedAt }, { $set: patch }, { new: true, runValidators: true, session });
    if (!updated) throw fail(409, "The venue changed or requires moderator approval.");
    if (patch.availability) await require("./venueRescheduleConflict.service").cancelConflictingRequests(id, session);
    return updated;
  });
}
module.exports = { commitVenueUpdate, syncManualBookings, validateManualSchedule, validateManualBookingWindow, openingMoney };
