const Booking = require("../../models/client/eventCenterBooking.schema");
const Refund = require("../../models/client/eventCenterRefund.schema");
const service = require("../../services/venueCancellation.service");
const valid = id => require("mongoose").Types.ObjectId.isValid(id);
exports.preview = async (req, res) => {
  try {
    if (!valid(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
    const booking = await Booking.findOne({ _id: req.params.id, buyer: req.user.id }).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    if (booking.status === "PENDING_REVIEW" && booking.paymentStatus === "COMPLETED") return res.json({ success: true, data: {
      canCancel: true, canWithdraw: true, refundMinor: Math.round(booking.totalPrice.amount * 100), currency: booking.totalPrice.currency,
      terms: "Withdraw this unapproved request. The full payment is queued for a payment-provider refund; completion is tracked separately.",
    } });
    res.json({ success: true, data: await service.preview(booking, true) });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Could not load cancellation policy." }); }
};
exports.cancel = async (req, res) => {
  try {
    if (!valid(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
    const owned = await Booking.findOne({ _id: req.params.id, buyer: req.user.id }).select("status").lean();
    if (!owned) return res.status(404).json({ message: "Booking not found." });
    const booking = owned.status === "PENDING_REVIEW"
      ? await require("../../services/venueLifecycle.service").cancelVenueBooking(req.params.id, { actor: req.user.id, mode: "withdraw", reason: req.body.reason || "Guest withdrew request", expectedRefundMinor: req.body.expectedRefundMinor })
      : await service.cancel(req.params.id, { actor: req.user.id, guest: true, reason: req.body.reason, expectedRefundMinor: req.body.expectedRefundMinor });
    res.json({ success: true, data: booking });
  } catch (error) { res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Could not cancel booking." }); }
};
exports.organiserRefund = async (req, res) => {
  try {
    if (!valid(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
    const booking = await Booking.findOne({ _id: req.params.id, organiser: req.user.id }).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    const refund = await Refund.findOne({ ticketId: booking._id, organiser: req.user.id })
      .select("+bankDetails.accountNumber +bankDetails.bankCode").populate("buyer", "firstName surname email").lean();
    res.json({ success: true, data: refund });
  } catch { res.status(500).json({ message: "Could not load refund." }); }
};
