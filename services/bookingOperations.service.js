const { bookingSessions, dayOf } = require("./bookingAttendance.service");
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const minor = amount => Math.round(Number(amount || 0) * 100);
function paymentSummary(booking, record = {}) {
  const totalMinor = minor(booking.totalPrice?.amount);
  const openingPaidMinor = record.openingPaidMinor ?? (booking.paymentStatus === "COMPLETED" ? totalMinor : minor(booking.depositAmount));
  let paidMinor = openingPaidMinor, securityMinor = 0;
  for (const payment of record.payments || []) {
    if (payment.kind === "PAYMENT") paidMinor += payment.amountMinor;
    if (payment.kind === "REFUND") paidMinor -= payment.amountMinor;
    if (payment.kind === "SECURITY_DEPOSIT") securityMinor += payment.amountMinor;
    if (payment.kind === "SECURITY_RETURN") securityMinor -= payment.amountMinor;
  }
  const balanceMinor = Math.max(0, totalMinor - paidMinor);
  return { totalMinor, paidMinor, balanceMinor, securityMinor, openingPaidMinor,
    currency: booking.totalPrice?.currency || "NGN", overdue: booking.status !== "CANCELLED" && balanceMinor > 0 && !!record.paymentDueDate && dayOf(record.paymentDueDate) < dayOf(new Date()) };
}
function applyOperation(booking, record, payload, actor, now = new Date()) {
  const next = JSON.parse(JSON.stringify(record));
  next.payments ||= []; next.handovers ||= []; next.audit ||= [];
  const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 500) : "";
  if (payload.action === "DETAILS") {
    const fields = { eventPurpose: 200, seating: 500, clientRequests: 2000, privateNotes: 4000 };
    for (const [key, max] of Object.entries(fields)) if (payload[key] !== undefined) {
      if (typeof payload[key] !== "string" || payload[key].length > max) fail(400, `Invalid ${key}.`);
      next[key] = payload[key].trim();
    }
    if (payload.guestCount !== undefined) {
      if (!Number.isInteger(payload.guestCount) || payload.guestCount < 0 || payload.guestCount > 1000000) fail(400, "Enter a valid guest count.");
      next.guestCount = payload.guestCount;
    }
    if (payload.paymentDueDate !== undefined) {
      if (payload.paymentDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(payload.paymentDueDate)) fail(400, "Use YYYY-MM-DD for the due date.");
      next.paymentDueDate = payload.paymentDueDate ? new Date(`${payload.paymentDueDate}T12:00:00Z`) : null;
      if (next.paymentDueDate && (Number.isNaN(next.paymentDueDate.getTime()) || next.paymentDueDate.toISOString().slice(0, 10) !== payload.paymentDueDate)) fail(400, "Invalid due date.");
    }
  } else if (payload.action === "PAYMENT") {
    const { kind, id, method } = payload;
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(id)) fail(400, "A payment reference key is required.");
    if (next.payments.some(entry => entry.id === id)) return record;
    if (!["PAYMENT", "REFUND", "SECURITY_DEPOSIT", "SECURITY_RETURN"].includes(kind)) fail(400, "Invalid payment type.");
    if (["PAYMENT", "REFUND"].includes(kind) && booking.bookingType !== "MANUAL") fail(400, "Online booking payments and refunds are managed by the payment service.");
    if (kind === "PAYMENT" && booking.status === "CANCELLED") fail(400, "Cannot collect payment for a cancelled booking.");
    if (!["CASH", "BANK_TRANSFER", "POS", "OTHER"].includes(method)) fail(400, "Choose a payment method.");
    const amountMinor = minor(payload.amount);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) fail(400, "Enter a positive payment amount.");
    const summary = paymentSummary(booking, next);
    if (kind === "PAYMENT" && amountMinor > summary.balanceMinor) fail(400, "Payment exceeds the outstanding balance.");
    if (kind === "REFUND" && amountMinor > summary.paidMinor) fail(400, "Refund exceeds recorded payments.");
    if (kind === "SECURITY_RETURN" && amountMinor > summary.securityMinor) fail(400, "Return exceeds the security deposit held.");
    if (["REFUND", "SECURITY_RETURN"].includes(kind) && !reason) fail(400, "A reason is required for a refund or deposit return.");
    next.payments.push({ id, kind, amountMinor, method, reference: String(payload.reference || "").slice(0, 150), reason, actor, at: now });
  } else if (payload.action === "HANDOVER") {
    const session = bookingSessions(booking).find(item => item.sessionId === payload.sessionId);
    if (!session || new Date(session.startsAt) > now) fail(400, "Choose a current or past booking session.");
    if (!reason) fail(400, "Add a handover note.");
    if (!Number.isInteger(payload.overtimeMinutes) || payload.overtimeMinutes < 0 || payload.overtimeMinutes > 10080) fail(400, "Enter valid overtime minutes.");
    const previous = next.handovers.find(item => item.sessionId === session.sessionId);
    const handover = { sessionId: session.sessionId, checkedOutAt: previous?.checkedOutAt || now, cleaned: payload.cleaned === true,
      damageNotes: String(payload.damageNotes || "").slice(0, 2000), overtimeMinutes: payload.overtimeMinutes, actor };
    next.handovers = [...next.handovers.filter(item => item.sessionId !== session.sessionId), handover];
  } else fail(400, "Unknown booking action.");
  next.revision = (record.revision || 0) + 1;
  next.audit.push({ action: payload.action, actor, at: now, reason: reason || "Booking details updated" });
  return next;
}
async function getRecord(venueId, booking, session = null) {
  const record = await require("../models/client/bookingOperations.schema").findById(`${venueId}:${booking._id}`).session(session).lean();
  return record || { _id: `${venueId}:${booking._id}`, eventCenter: venueId, bookingId: String(booking._id), revision: 0,
    openingPaidMinor: paymentSummary(booking).paidMinor, payments: [], handovers: [], audit: [] };
}
async function saveOperation(venueId, booking, payload, actor) {
  const Model = require("../models/client/bookingOperations.schema");
  return require("mongoose").connection.transaction(async session => {
    // Read the current manual schedule inside the same transaction as its ledger.
    if (booking.bookingType === "MANUAL" && payload.action === "PAYMENT") {
      const Venue = require("../models/client/eventCenter.schema");
      const venue = await Venue.findById(venueId).session(session).lean();
      if (!venue) fail(404, "Venue not found.");
      const current = require("./manualBookingRead.service").buildManualBookings([venue]).find(item => String(item._id) === String(booking._id));
      booking = current || { ...booking, status: "CANCELLED" };
      // Also serialize refunds for removed bookings against calendar edits.
      await Venue.updateOne({ _id: venueId }, { $currentDate: { updatedAt: true } }, { session });
    }
    const record = await getRecord(venueId, booking, session);
    if (payload.action === "PAYMENT" && record.payments.some(payment => payment.id === payload.id)) return record;
    if (payload.expectedRevision !== record.revision) fail(409, "Booking details changed. Refresh and try again.");
    const next = applyOperation(booking, record, payload, actor);
    next.eventCenter = venueId; next._id = record._id;
    const data = { ...next }; delete data._id; delete data.createdAt; delete data.updatedAt; delete data.__v;
    let saved;
    try {
      if (!record.createdAt) saved = (await Model.create([next], { session }))[0].toObject();
      else saved = await Model.findOneAndUpdate({ _id: record._id, revision: record.revision }, { $set: data }, { new: true, runValidators: true, session }).lean();
      if (!saved) fail(409, "Booking details changed. Refresh and try again.");
    } catch (error) { if (error.code === 11000) fail(409, "Booking details changed. Refresh and try again."); throw error; }
    if (booking.bookingType === "MANUAL" && payload.action === "PAYMENT") {
      const summary = paymentSummary(booking, next);
      const status = summary.balanceMinor === 0 ? "paid" : summary.paidMinor > 0 ? "partially_paid" : "pending";
      const Venue = require("../models/client/eventCenter.schema");
      for (const field of ["unavailableDates", "unavailableSlots"]) await Venue.updateOne({ _id: venueId, [`availability.${field}.bookingId`]: String(booking._id) },
        { $set: { [`availability.${field}.$[booking].depositAmount`]: summary.paidMinor / 100, [`availability.${field}.$[booking].paymentStatus`]: status } },
        { arrayFilters: [{ "booking.bookingId": String(booking._id) }], session });
    }
    return saved;
  });
}
function confirmationText(booking, record, venueName) {
  const summary = paymentSummary(booking, record);
  const money = amount => `${summary.currency} ${(amount / 100).toFixed(2)}`;
  return ["Munasaba booking confirmation", venueName || booking.eventCenter?.venueName || "Venue",
    `Reference: ${booking._id}`, `Guest: ${booking.guestName || booking.guestDetails?.fullName || "Guest"}`, `Status: ${booking.status}`,
    ...bookingSessions(booking).map(s => `${s.date}${s.allDay ? " (all day)" : ` ${s.startTime}-${s.endTime}`}`),
    `Agreed price: ${money(summary.totalMinor)}`, `Paid: ${money(summary.paidMinor)}`, `Balance due: ${money(summary.balanceMinor)}`,
    record.paymentDueDate ? `Payment due: ${dayOf(record.paymentDueDate)}` : "",
    record.eventPurpose ? `Event: ${record.eventPurpose}` : "",
    record.guestCount ? `Expected guests: ${record.guestCount}` : "",
    "Attendance and payment are tracked separately. Contact the venue for changes.",
  ].filter(Boolean).join("\n");
}
module.exports = { paymentSummary, applyOperation, getRecord, saveOperation, confirmationText };
