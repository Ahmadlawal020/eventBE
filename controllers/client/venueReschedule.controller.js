const mongoose = require("mongoose"), { randomUUID } = require("crypto");
const Booking = require("../../models/client/eventCenterBooking.schema"), Venue = require("../../models/client/eventCenter.schema");
const { fail, requireVenuePermission } = require("../../services/venueAccess.service");
const { queueNotices } = require("../../services/eventCenterRefundNotifications.service");
const { rescheduleTerms } = require("../../services/venueReschedulePolicy.service");
const handle = fn => async (req, res) => { try { await fn(req,res); } catch(e) { const status = e.status || e.statusCode || (e.name === "CastError" ? 400 : 500); res.status(status).json({ message: status === 500 ? "Could not process the date change." : e.message }); } };
exports.get = handle(async (req,res) => {
  let b = await Booking.findById(req.params.id).lean(); if (!b) throw fail(404,"Booking not found.");
  let approval, availability;
  const venue = await Venue.findById(b.eventCenter).lean();
  const organiser = String(b.buyer) !== String(req.user.id);
  if (organiser) await requireVenuePermission(req.user.id, venue, ["MANAGE_CALENDAR"]);
  // Reconcile older pending requests when opened; normal confirmations cancel them in their own transaction.
  if (b.rescheduleRequest?.status === "PENDING") {
    const result = await require("../../services/venueRescheduleConflict.service").checkPendingRequest(b._id, b.rescheduleRequest.id);
    if (result.cancelled) b = await Booking.findById(b._id).lean();
  }
  if (organiser) {
    if (b.rescheduleRequest?.status === "PENDING") {
      approval = { requestId: b.rescheduleRequest.id, canApprove: false, reason: null, checkedAt: new Date() };
      try {
        await require("../../services/venueLifecycle.service").quoteReschedule(b, venue, b.rescheduleRequest.dates);
        approval.canApprove = true;
      } catch (error) {
        if (![400, 409].includes(error.status || error.statusCode)) throw error;
        approval.reason = error.message;
      }
    }
  }
  if (b.rescheduleRequest?.status === "PENDING") {
    availability = require("../../services/venueRescheduleConflict.service").requestedAvailability(b, venue);
  }
  res.json({ data: b.rescheduleRequest || null,
    eligibility: { ...rescheduleTerms(b), canReplaceRequest: b.rescheduleRequest?.status === "PENDING" && rescheduleTerms({ ...b, rescheduleRequest: undefined }).canRequest },
    ...(approval ? { approval } : {}), ...(availability ? { availability } : {}) });
});
exports.availability = handle(async (req, res) => {
  const b = await Booking.findOne({ _id: req.params.id, buyer: req.user.id }).lean();
  if (!b) throw fail(404, "Booking not found.");
  const terms = rescheduleTerms(b);
  if (!terms.canRequest) throw fail(409, terms.reason);
  const venue = await Venue.findById(b.eventCenter).lean();
  if (!venue || venue.status !== "LISTED" || venue.archivedAt) throw fail(409, "Venue is not accepting bookings.");
  const settings = await require("../../services/eventCenterSettings.service").getEventCenterSettings();
  const data = require("../../services/venueRescheduleAvailability.service").rescheduleAvailability(b, venue, settings, req.query.month);
  res.json({ data: { ...data, deadline: terms.deadline } });
});
exports.request = handle(async (req,res) => {
  const data = await mongoose.connection.transaction(async session => {
    const b = await Booking.findOne({ _id: req.params.id, buyer: req.user.id, paymentStatus: "COMPLETED", status: { $in: ["ACTIVE", "CONFIRMED"] } }).session(session);
    if (!b) throw fail(409,"Only paid confirmed bookings can request a date change.");
    const terms = rescheduleTerms(b);
    if (!terms.canRequest) throw fail(409, terms.reason);
    require("../../services/venueLifecycle.service").assertFutureBooking(b);
    if (b.rescheduleRequest?.status === "PENDING") throw fail(409,"Withdraw your pending request before submitting another.");
    const v = await Venue.findById(b.eventCenter).session(session).lean();
    const { quote } = await require("../../services/venueLifecycle.service").quoteReschedule(b, v, req.body.dates);
    if (typeof req.body.reason !== "string" || !req.body.reason.trim() || req.body.reason.length > 500) throw fail(400,"Enter a reason of up to 500 characters.");
    // Serialize request creation with confirmations so no conflicting request slips past cancellation.
    await Venue.updateOne({ _id: b.eventCenter }, { $inc: { bookingVersion: 1 } }, { session });
    b.rescheduleRequest = { id: randomUUID(), status: "PENDING", dates: quote.selectedDates, reason: req.body.reason.trim(), requestedAt: new Date() };
    await b.save({ session });
    await queueNotices([{ key: `reschedule-request:${b.rescheduleRequest.id}`, recipient: b.organiser, sender: b.buyer, type: "SYSTEM", title: "Date change requested", message: "A guest requested new booking dates. The original dates remain reserved until you approve.", data: { screen: "VenueBookingOperations", bookingId: String(b._id), venueId: String(b.eventCenter) } }],session);
    return b.rescheduleRequest;
  });
  res.json({ data });
});
exports.resolve = handle(async (req,res) => {
  const { action, requestId } = req.body;
  if (!["ACCEPTED","DECLINED","WITHDRAWN"].includes(action) || typeof requestId !== "string") throw fail(400,"Choose an action and current request.");
  if (action === "ACCEPTED") {
    const b = await require("../../services/venueLifecycle.service").rescheduleVenueBooking(req.params.id, [], req.user.id, requestId);
    return res.json({ data: b.rescheduleRequest });
  }
  const data = await mongoose.connection.transaction(async session => {
    const b = await Booking.findOne({ _id: req.params.id, "rescheduleRequest.id": requestId, "rescheduleRequest.status": "PENDING" }).session(session);
    if (!b) throw fail(409,"Request is no longer pending.");
    if (action === "WITHDRAWN") { if (String(b.buyer) !== String(req.user.id)) throw fail(403,"Only the customer can withdraw."); }
    else {
      const venue = await Venue.findById(b.eventCenter).session(session).lean();
      await requireVenuePermission(req.user.id, venue, ["MANAGE_CALENDAR"]);
      const { requestedAvailability, conflictReason } = require("../../services/venueRescheduleConflict.service");
      const availability = requestedAvailability(b, venue);
      if (req.body.reason !== undefined && (typeof req.body.reason !== "string" || req.body.reason.length > 500))
        throw fail(400, "Enter a decline reason of up to 500 characters.");
      const reason = (req.body.reason || "").trim();
      if (!availability.hasConflict && !reason) throw fail(400, "Explain why you are declining this reschedule request.");
      // Keep the conflict explanation consistent with concurrent calendar edits.
      await Venue.updateOne({ _id: venue._id }, { $inc: { bookingVersion: 1 } }, { session });
      b.rescheduleRequest.resolutionCode = availability.hasConflict ? "UNAVAILABLE" : "ORGANISER_DECLINED";
      b.rescheduleRequest.resolutionReason = availability.hasConflict
        ? conflictReason(availability) + (reason ? " Organiser note: " + reason : "")
        : reason;
      b.rescheduleRequest.resolutionAvailability = availability.dates;
    }
    b.rescheduleRequest.status = action; b.rescheduleRequest.resolvedAt = new Date(); b.rescheduleRequest.resolvedBy = req.user.id;
    await b.save({ session });
    if (action === "DECLINED") await require("../../services/venueRescheduleConflict.service").recordResolution(b, session, req.user.id);
    await queueNotices([{ key: `reschedule-result:${requestId}`, recipient: action === "WITHDRAWN" ? b.organiser : b.buyer, sender: req.user.id, type: "SYSTEM", title: "Date change " + action.toLowerCase(), message: (b.rescheduleRequest.resolutionReason ? b.rescheduleRequest.resolutionReason + " " : "") + "The original booking dates remain in place.", data: { screen: action === "WITHDRAWN" ? "VenueBookingOperations" : "TicketDetails", bookingId: String(b._id), ticketId: String(b._id), venueId: String(b.eventCenter) } }],session);
    return b.rescheduleRequest;
  });
  res.json({ data });
});
