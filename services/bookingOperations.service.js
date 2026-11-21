const { bookingSessions, dayOf } = require("./bookingAttendance.service");
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const minor = amount => Math.round(Number(amount || 0) * 100);
function paymentSummary(booking, record = {}) {
  const totalMinor = minor(record.agreedPrice?.amount ?? booking.rescheduledPrice?.amount ?? booking.totalPrice?.amount);
  const openingPaidMinor = record.openingPaidMinor ?? (booking.paymentStatus === "COMPLETED" ? minor(booking.totalPrice?.amount) : minor(booking.depositAmount));
  let paidMinor = openingPaidMinor, securityMinor = 0;
  for (const payment of record.payments || []) {
    if (payment.kind === "PAYMENT") paidMinor += payment.amountMinor;
    if (payment.kind === "REFUND") paidMinor -= payment.amountMinor;
    if (payment.kind === "SECURITY_DEPOSIT") securityMinor += payment.amountMinor;
    if (payment.kind === "SECURITY_RETURN") securityMinor -= payment.amountMinor;
  }
  const balanceMinor = booking.status === "CANCELLED" ? 0 : Math.max(0, totalMinor - paidMinor);
  const isManual = booking.bookingType === "MANUAL" || String(booking._id || booking.bookingId || "").startsWith("manual-");
  const basePlatformFeeMinor = isManual
    ? 0
    : booking.platformFeeAmount != null
      ? minor(booking.platformFeeAmount)
      : booking.subtotalPrice?.amount != null && booking.totalPrice?.amount != null
        ? Math.max(0, minor(booking.totalPrice.amount) - minor(booking.subtotalPrice.amount))
        : 0;
  const platformFeeMinor = basePlatformFeeMinor + (isManual ? 0 : Number(record.rescheduleBuyerFeesMinor || 0));
  const organiserTotalMinor = Math.max(0, totalMinor - platformFeeMinor);
  const organiserPaidMinor = Math.max(0, paidMinor - (booking.paymentStatus === "COMPLETED" || record.openingPaidMinor != null ? platformFeeMinor : 0));
  return { totalMinor, paidMinor, balanceMinor, refundDueMinor: booking.status === "CANCELLED" ? paidMinor : Math.max(0, paidMinor - totalMinor), securityMinor, openingPaidMinor,
    organiserTotalMinor, organiserPaidMinor, platformFeeMinor,
    currency: booking.totalPrice?.currency || "NGN", overdue: booking.status !== "CANCELLED" && balanceMinor > 0 && !!record.paymentDueDate && dayOf(record.paymentDueDate) < dayOf(new Date()) };
}
function applyOperation(booking, record, payload, actor, now = new Date()) {
  const next = JSON.parse(JSON.stringify(record));
  next.payments ||= []; next.refunds ||= []; next.handovers ||= []; next.audit ||= [];
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
  } else if (payload.action === "REFUND_APPROVE") {
    if (booking.bookingType !== "MANUAL" && (!record.rescheduleAdjustment || booking.status === "CANCELLED")) fail(400, "Use the online refund workflow for this booking.");
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(payload.id || "") || !reason) fail(400, "A refund key and reason are required.");
    if (next.refunds.some(r => r.id === payload.id)) return record;
    const amountMinor = minor(payload.amount), available = (record.rescheduleAdjustment && booking.status !== "CANCELLED" ? paymentSummary(booking, next).refundDueMinor : paymentSummary(booking, next).paidMinor) - next.refunds.filter(r => r.status === "APPROVED").reduce((n,r) => n + r.amountMinor, 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > available) fail(400, "Approval exceeds unallocated collections.");
    next.refunds.push({ id: payload.id, amountMinor, reason, status: "APPROVED", approvedAt: now, approvedBy: actor });
  } else if (payload.action === "REFUND_CONFIRM") {
    const refund = next.refunds.find(r => r.id === payload.refundId);
    if (!refund || refund.status === "APPROVED") fail(409, "Record the payment before confirming receipt.");
    if (refund.status === "CONFIRMED") return record;
    if (record.customerId && String(record.customerId) !== String(actor)) fail(403, "The linked customer must confirm receipt in their account.");
    if (!record.customerId && !reason) fail(400, "Record the customer's receipt acknowledgement or receipt reference.");
    Object.assign(refund, { status: "CONFIRMED", confirmedAt: now, confirmedBy: actor, confirmationEvidence: reason || "Customer confirmed in their account" });
  } else if (payload.action === "PAYMENT") {
    const { kind, id, method } = payload;
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(id)) fail(400, "A payment reference key is required.");
    if (next.payments.some(entry => entry.id === id)) return record;
    if (!["PAYMENT", "REFUND", "SECURITY_DEPOSIT", "SECURITY_RETURN"].includes(kind)) fail(400, "Invalid payment type.");
    if (["PAYMENT", "REFUND"].includes(kind) && booking.bookingType !== "MANUAL" && !record.rescheduleAdjustment) fail(400, "Online booking payments and refunds are managed by the payment service.");
    if (record.rescheduleAdjustment && ["PAYMENT", "REFUND"].includes(kind) && !String(payload.reference || "").trim()) fail(400, "Enter the receipt or transfer reference.");
    if (record.rescheduleAdjustment && booking.bookingType !== "MANUAL" && booking.status === "CANCELLED" && kind === "REFUND") fail(409, "Use the cancellation refund workflow.");
    if (kind === "PAYMENT" && booking.status === "CANCELLED") fail(400, "Cannot collect payment for a cancelled booking.");
    if (!["CASH", "BANK_TRANSFER", "POS", "OTHER"].includes(method)) fail(400, "Choose a payment method.");
    const amountMinor = minor(payload.amount);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) fail(400, "Enter a positive payment amount.");
    const summary = paymentSummary(booking, next);
    if (kind === "PAYMENT" && amountMinor > summary.balanceMinor) fail(400, "Payment exceeds the outstanding balance.");
    if (kind === "REFUND" && amountMinor > summary.paidMinor) fail(400, "Refund exceeds recorded payments.");
    if (kind === "SECURITY_RETURN" && amountMinor > summary.securityMinor) fail(400, "Return exceeds the security deposit held.");
    if (["REFUND", "SECURITY_RETURN"].includes(kind) && !reason) fail(400, "A reason is required for a refund or deposit return.");
    if (kind === "REFUND") {
      const refund = next.refunds.find(r => r.id === payload.refundId);
      if (!refund || refund.status !== "APPROVED" || refund.amountMinor !== amountMinor) fail(409, "Approve this refund installment before recording it as sent.");
      if (!refund.settlement?.id || refund.settlement.method !== method || !refund.receipt?.publicId || refund.receipt.settlementId !== refund.settlement.id) fail(409, "Prepare the refund account and upload proof of this payment before marking it sent.");
      Object.assign(refund, { status: "SENT", sentAt: now });
    }
    next.payments.push({ id, kind, refundId: payload.refundId, amountMinor, method, reference: String(payload.reference || "").slice(0, 150), reason, actor, at: now });
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
    if (booking.bookingType === "MANUAL" && ["PAYMENT", "REFUND_APPROVE", "REFUND_CONFIRM"].includes(payload.action)) {
      const Venue = require("../models/client/eventCenter.schema");
      const venue = await Venue.findById(venueId).session(session).lean();
      if (!venue) fail(404, "Venue not found.");
      if (venue.archivedAt) fail(409, "Archived venues cannot accept new financial operations.");
      const current = require("./manualBookingRead.service").buildManualBookings([venue]).find(item => String(item._id) === String(booking._id));
      booking = current || { ...booking, status: "CANCELLED" };
      // Also serialize refunds for removed bookings against calendar edits.
      await Venue.updateOne({ _id: venueId }, { $currentDate: { updatedAt: true } }, { session });
    }
    if (booking.bookingType !== "MANUAL" && ["PAYMENT", "REFUND_APPROVE", "REFUND_CONFIRM"].includes(payload.action)) {
      const Model = require("../models/client/eventCenterBooking.schema");
      booking = await Model.findById(booking._id).session(session).lean();
      if (!booking) fail(404, "Booking not found.");
      await Model.updateOne({ _id: booking._id }, { $currentDate: { updatedAt: true } }, { session });
    }
    if (booking.rescheduleCheckoutId) fail(409, "Finish or check the pending reschedule payment before changing payments.");
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
    if ((booking.bookingType === "MANUAL" || record.rescheduleAdjustment) && ["PAYMENT", "REFUND_APPROVE", "REFUND_CONFIRM"].includes(payload.action)) {
      const venue = await require("../models/client/eventCenter.schema").findById(venueId).session(session).lean();
      const venueLabel = venue?.venueName || "Venue";
      const hostRecipients = [...new Set([venue?.createdBy, ...(venue?.coOrganisers || [])].filter(Boolean).map(String))];
      const customerRecipient = record.customerId ? String(record.customerId) : null;
      const currency = booking.totalPrice?.currency || "NGN";
      const formattedAmount = payload.amount != null
        ? `${currency} ${Number(payload.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";
      const customerScreen = booking.bookingType === "MANUAL" ? "ManualVenueBooking" : "TicketDetails";
      const notices = [];
      if (payload.action === "REFUND_APPROVE" && customerRecipient) {
        notices.push({
          key: `manual-finance:${record._id}:${saved.revision}:${customerRecipient}`,
          recipient: customerRecipient,
          type: "SYSTEM",
          title: "Reschedule refund approved",
          message: `${venueLabel}: a refund of ${formattedAmount} was approved. Open your ticket to share your bank details if you haven't already.`,
          data: { screen: customerScreen, ticketId: String(booking._id), venueId: String(venueId), bookingId: String(booking._id) },
        });
      } else if (payload.action === "PAYMENT" && payload.kind === "REFUND" && customerRecipient) {
        notices.push({
          key: `manual-finance:${record._id}:${saved.revision}:${customerRecipient}`,
          recipient: customerRecipient,
          type: "SYSTEM",
          title: "Refund marked as sent",
          message: `${venueLabel}: your refund of ${formattedAmount} was marked as sent. Open your ticket to check payment proof and confirm receipt.`,
          data: { screen: customerScreen, ticketId: String(booking._id), venueId: String(venueId), bookingId: String(booking._id) },
        });
      } else if (payload.action === "PAYMENT" && payload.kind === "PAYMENT" && customerRecipient) {
        notices.push({
          key: `manual-finance:${record._id}:${saved.revision}:${customerRecipient}`,
          recipient: customerRecipient,
          type: "SYSTEM",
          title: "Payment recorded",
          message: `${venueLabel}: your payment of ${formattedAmount} was recorded.`,
          data: { screen: customerScreen, ticketId: String(booking._id), venueId: String(venueId), bookingId: String(booking._id) },
        });
      } else if (payload.action === "REFUND_CONFIRM") {
        for (const recipient of hostRecipients) {
          notices.push({
            key: `manual-finance:${record._id}:${saved.revision}:${recipient}`,
            recipient,
            type: "SYSTEM",
            title: "Refund receipt confirmed",
            message: `${venueLabel}: the client confirmed receiving their refund.`,
            data: { screen: "VenueBookingOperations", ticketId: String(booking._id), venueId: String(venueId), bookingId: String(booking._id) },
          });
        }
      }
      if (notices.length) {
        await require("./eventCenterRefundNotifications.service").queueNotices(notices, session);
      }
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
