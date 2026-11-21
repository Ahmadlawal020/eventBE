const mongoose = require("mongoose");
const Booking = require("../../models/client/eventBooking.schema");
const VenueBooking = require("../../models/client/eventCenterBooking.schema");
const Audit = require("../../models/management/adminAuditLog.schema");
const Refund = require("../../models/client/eventRefund.schema");
const VenueRefund = require("../../models/client/eventCenterRefund.schema");
const { queueNotices } = require("../../services/refundNotifications.service");
const { queueNotices: queueVenueNotices } = require("../../services/eventCenterRefundNotifications.service");
function allowed(req) {
  return (req.managementStaff?.roles || req.user?.roles || []).some(role =>
    ["admin", "super_admin", "superadmin", "finance_admin", "finance"].includes(role));
}
const fail = (message, status = 409) => Object.assign(Error(message), { status });
async function list(req, res) {
  try {
    if (!allowed(req)) return res.status(403).json({ success: false, message: "Finance access required" });
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page) || 1));
    const eventFilter = { paymentResolutionRequired: true };
    const venueFilter = {
      $or: [
        { paymentResolutionRequired: true },
        { paymentStatus: "FAILED_REFUND" },
        { "refund.state": "NEEDS_ATTENTION" },
      ],
    };
    const [eventItems, venueItems, eventTotal, venueTotal, oldestEvent, oldestVenue] = await Promise.all([
      Booking.find(eventFilter).sort({ createdAt: 1, _id: 1 }).limit(200)
        .populate("buyer", "firstName surname email").populate("eventId", "title status")
        .populate("paymentResolution.owner", "firstName surname email").lean(),
      VenueBooking.find(venueFilter).sort({ createdAt: 1, _id: 1 }).limit(200)
        .populate("buyer", "firstName surname email").populate("eventCenter", "venueName status")
        .populate("paymentResolution.owner", "firstName surname email").lean(),
      Booking.countDocuments(eventFilter),
      VenueBooking.countDocuments(venueFilter),
      Booking.findOne(eventFilter).sort({ createdAt: 1 }).select("createdAt").lean(),
      VenueBooking.findOne(venueFilter).sort({ createdAt: 1 }).select("createdAt").lean(),
    ]);
    const normalizedVenueItems = venueItems.map(item => ({
      ...item,
      bookingType: "event-center",
      totalAmount: item.refund?.amountMinor || Math.round((item.totalPrice?.amount || 0) * 100),
      currency: item.totalPrice?.currency || "NGN",
    }));
    const normalizedEventItems = eventItems.map(item => ({
      ...item,
      bookingType: "event",
    }));
    const combined = [...normalizedEventItems, ...normalizedVenueItems]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));
    const total = eventTotal + venueTotal;
    const items = combined.slice((page - 1) * 20, page * 20);
    const oldestCandidates = [oldestEvent?.createdAt, oldestVenue?.createdAt].filter(Boolean).map(d => new Date(d));
    const oldestAt = oldestCandidates.length ? new Date(Math.min(...oldestCandidates)).toISOString() : null;
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / 20), oldestAt } });
  } catch (error) { res.status(500).json({ success: false, message: "Could not load payment exceptions" }); }
}
async function update(req, res) {
  try {
    if (!allowed(req)) return res.status(403).json({ success: false, message: "Finance access required" });
    if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid booking", 400);
    const { action, settlementReference, notes } = req.body;
    if (!["CLAIM", "RECORD_REFUND", "RETRY_PROVIDER_REFUND"].includes(action)) throw fail("Invalid recovery action", 400);
    if (action === "RECORD_REFUND" && (
      typeof settlementReference !== "string" || settlementReference.trim().length < 5 || settlementReference.length > 200 ||
      typeof notes !== "string" || notes.trim().length < 10 || notes.length > 2000 || req.body.confirmFullRefund !== true))
      throw fail("Supply the external settlement reference, verification notes and full-refund confirmation.", 400);
    const result = await mongoose.connection.transaction(async session => {
      let booking = await Booking.findOne({ _id: req.params.id, paymentResolutionRequired: true }).session(session);
      let isVenue = false;
      if (!booking) {
        booking = await VenueBooking.findOne({
          _id: req.params.id,
          $or: [
            { paymentResolutionRequired: true },
            { paymentStatus: "FAILED_REFUND" },
            { "refund.state": "NEEDS_ATTENTION" },
          ],
        }).session(session);
        isVenue = Boolean(booking);
      }
      if (!booking) throw fail("This payment is no longer awaiting resolution");
      const before = booking.paymentResolution?.toObject?.() || booking.paymentResolution || {};
      const amountMinor = isVenue
        ? booking.refund?.amountMinor || Math.round((booking.totalPrice?.amount || 0) * 100)
        : booking.totalAmount;
      const currency = isVenue ? booking.totalPrice?.currency || "NGN" : booking.currency;
      const targetType = isVenue ? "EventCenterBooking" : "EventBooking";

      if (action === "CLAIM") {
        if (before.owner && String(before.owner) !== req.user.id) throw fail("Another finance operator owns this case");
        booking.paymentResolution = { ...before, owner: req.user.id, claimedAt: new Date() };
      } else if (action === "RETRY_PROVIDER_REFUND") {
        if (!isVenue) throw fail("Automatic provider refund retry is only available for venue bookings", 400);
        if (String(before.owner) !== req.user.id) throw fail("Claim this case before retrying provider refund");
        if (booking.status !== "CANCELLED") throw fail("Only cancelled venue bookings can be queued for a provider refund");
        if (await VenueRefund.exists({ bookingId: booking._id }).session(session))
          throw fail("This booking has a direct organiser refund record. Resolve it in the venue refund workspace to avoid double refunds.");
        booking.refund = {
          ...(booking.refund?.toObject?.() || booking.refund || {}),
          state: "QUEUED",
          requestedAt: booking.refund?.requestedAt || new Date(),
          amountMinor,
          leaseUntil: new Date(),
          leaseToken: undefined,
          lastError: "",
        };
        booking.paymentResolutionRequired = true;
        booking.paymentResolution = { ...before, notes: typeof notes === "string" && notes.trim() ? notes.trim() : before.notes };
      } else {
        if (String(before.owner) !== req.user.id) throw fail("Claim this case before recording settlement");
        if (!["COMPLETED", "FAILED_REFUND"].includes(booking.paymentStatus) || booking.status !== "CANCELLED")
          throw fail("Only collected payments without an active booking can be settled here");
        if (!isVenue && await Refund.exists({ bookingId: booking._id }).session(session))
          throw fail("This booking has cancellation refunds. Resolve it in the cancellation refund workspace to avoid double refunds.");
        if (isVenue && await VenueRefund.exists({ bookingId: booking._id }).session(session))
          throw fail("This booking has a direct organiser refund record. Resolve it in the venue refund workspace to avoid double refunds.");
        booking.paymentResolution = { ...before, resolvedAt: new Date(), resolvedBy: req.user.id,
          settlementReference: settlementReference.trim(), notes: notes.trim() };
        booking.paymentResolutionRequired = false;
        booking.paymentStatus = "REFUNDED";
        if (isVenue && booking.refund?.state) {
          booking.refund.state = "PROCESSED";
          booking.refund.lastError = "";
        }
        const noticePayload = [{
          key: "payment-exception-refunded:" + booking._id, recipient: booking.buyer, type: "SYSTEM",
          title: "Payment refund recorded",
          message: "Our finance team recorded a full external refund for payment " + booking.paymentReference +
            ". Contact support with this reference if the money has not arrived.",
          data: isVenue
            ? { screen: "BookingDetails", ticketId: String(booking._id), bookingId: String(booking._id) }
            : { screen: "Tickets", bookingId: String(booking._id) },
        }];
        if (isVenue) await queueVenueNotices(noticePayload, session);
        else await queueNotices(noticePayload, session);
      }
      await booking.save({ session });
      await Audit.create([{ admin: req.user.id, action: "PAYMENT_EXCEPTION_" + action, targetType,
        targetId: booking._id, previousValue: before, newValue: booking.paymentResolution,
        metadata: { amountMinor, currency, externalSettlementOnly: action === "RECORD_REFUND" } }], { session });
      return { booking, isVenue };
    });
    if (req.body.action === "RETRY_PROVIDER_REFUND" && result.isVenue) {
      try {
        await require("../../services/venueRefund.service").processVenueRefund(result.booking._id);
      } catch (err) {
        console.error("[ADMIN RETRY VENUE REFUND]", err.message);
      }
    }
    res.json({ success: true, data: result.booking });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Could not update payment exception" }); }
}
module.exports = { list, update, allowed };
