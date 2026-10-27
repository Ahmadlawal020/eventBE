const mongoose = require("mongoose");
const Booking = require("../../models/client/eventBooking.schema");
const Audit = require("../../models/management/adminAuditLog.schema");
const Refund = require("../../models/client/eventRefund.schema");
const { queueNotices } = require("../../services/refundNotifications.service");
function allowed(req) {
  return (req.managementStaff?.roles || req.user?.roles || []).some(role =>
    ["admin", "super_admin", "superadmin", "finance_admin", "finance"].includes(role));
}
const fail = (message, status = 409) => Object.assign(Error(message), { status });
async function list(req, res) {
  try {
    if (!allowed(req)) return res.status(403).json({ success: false, message: "Finance access required" });
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page) || 1));
    const filter = { paymentResolutionRequired: true };
    const [items, total, oldest] = await Promise.all([
      Booking.find(filter).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * 20).limit(20)
        .populate("buyer", "firstName surname email").populate("eventId", "title status")
        .populate("paymentResolution.owner", "firstName surname email").lean(),
      Booking.countDocuments(filter),
      Booking.findOne(filter).sort({ createdAt: 1 }).select("createdAt").lean(),
    ]);
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / 20), oldestAt: oldest?.createdAt || null } });
  } catch (error) { res.status(500).json({ success: false, message: "Could not load payment exceptions" }); }
}
async function update(req, res) {
  try {
    if (!allowed(req)) return res.status(403).json({ success: false, message: "Finance access required" });
    if (!mongoose.isValidObjectId(req.params.id)) throw fail("Invalid booking", 400);
    const { action, settlementReference, notes } = req.body;
    if (!["CLAIM", "RECORD_REFUND"].includes(action)) throw fail("Invalid recovery action", 400);
    if (action === "RECORD_REFUND" && (
      typeof settlementReference !== "string" || settlementReference.trim().length < 5 || settlementReference.length > 200 ||
      typeof notes !== "string" || notes.trim().length < 10 || notes.length > 2000 || req.body.confirmFullRefund !== true))
      throw fail("Supply the external settlement reference, verification notes and full-refund confirmation.", 400);
    const result = await mongoose.connection.transaction(async session => {
      const booking = await Booking.findOne({ _id: req.params.id, paymentResolutionRequired: true }).session(session);
      if (!booking) throw fail("This payment is no longer awaiting resolution");
      const before = booking.paymentResolution?.toObject?.() || booking.paymentResolution || {};
      if (action === "CLAIM") {
        if (before.owner && String(before.owner) !== req.user.id) throw fail("Another finance operator owns this case");
        booking.paymentResolution = { ...before, owner: req.user.id, claimedAt: new Date() };
      } else {
        if (String(before.owner) !== req.user.id) throw fail("Claim this case before recording settlement");
        if (booking.paymentStatus !== "COMPLETED" || booking.status !== "CANCELLED") throw fail("Only collected payments without an active booking can be settled here");
        if (await Refund.exists({ bookingId: booking._id }).session(session))
          throw fail("This booking has cancellation refunds. Resolve it in the cancellation refund workspace to avoid double refunds.");
        booking.paymentResolution = { ...before, resolvedAt: new Date(), resolvedBy: req.user.id,
          settlementReference: settlementReference.trim(), notes: notes.trim() };
        booking.paymentResolutionRequired = false;
        booking.paymentStatus = "REFUNDED";
        await queueNotices([{
          key: "payment-exception-refunded:" + booking._id, recipient: booking.buyer, type: "SYSTEM",
          title: "Payment refund recorded",
          message: "Our finance team recorded a full external refund for payment " + booking.paymentReference +
            ". Contact support with this reference if the money has not arrived.",
          data: { screen: "Tickets", bookingId: String(booking._id) },
        }], session);
      }
      await booking.save({ session });
      await Audit.create([{ admin: req.user.id, action: "PAYMENT_EXCEPTION_" + action, targetType: "EventBooking",
        targetId: booking._id, previousValue: before, newValue: booking.paymentResolution,
        metadata: { amountMinor: booking.totalAmount, currency: booking.currency, externalSettlementOnly: true } }], { session });
      return booking;
    });
    res.json({ success: true, data: result });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Could not update payment exception" }); }
}
module.exports = { list, update, allowed };
