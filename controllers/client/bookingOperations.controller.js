const mongoose = require("mongoose");
const Venue = require("../../models/client/eventCenter.schema");
const { loadBooking, attendanceForBookings } = require("../../services/bookingAttendance.service");
const { paymentSummary, getRecord, saveOperation, confirmationText } = require("../../services/bookingOperations.service");
async function financeAccess(userId, venue) {
  if (String(venue.createdBy) === String(userId)) return true;
  const invites = await Promise.all([
    require("../../models/client/coOrganiserInvitation.schema").findOne({ coOrganiser: userId, host: venue.createdBy, status: "ACCEPTED", "listings.listingId": venue._id, permissions: { $in: ["VIEW_FINANCES", "ALL_ACCESS"] } }).lean(),
    require("../../models/client/staffInvitation.schema").findOne({ staff: userId, organiser: venue.createdBy, status: "ACCEPTED", "listings.listingId": venue._id, permissions: { $in: ["VIEW_FINANCES", "ALL_ACCESS"] } }).lean(),
  ]);
  return invites.some(Boolean);
}
const handleError = (res, error) => { if (!error.status) console.error("[BOOKING OPERATIONS]", error); return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Could not complete the booking action." }); };
exports.handlers = authorize => ({
  details: async (req, res) => {
    try {
      const venueId = req.query.eventCenterId;
      if (!mongoose.Types.ObjectId.isValid(venueId)) return res.status(400).json({ message: "Invalid venue." });
      const access = await authorize(req.user.id, venueId, false);
      if (!access.authorized) return res.status(403).json({ message: access.error });
      const venue = await Venue.findById(venueId).lean();
      const booking = await loadBooking(venueId, req.params.bookingId);
      const record = await getRecord(venueId, booking);
      const canFinance = await financeAccess(req.user.id, venue);
      const summary = canFinance ? paymentSummary(booking, record) : null;
      const safe = canFinance ? { ...record, refunds: (record.refunds || []).map(f => ({ ...f, receipt: f.receipt?.uploadedAt ? { uploadedAt: f.receipt.uploadedAt } : undefined })) } : { ...record, refundAccount: undefined, agreedPrice: undefined, openingPaidMinor: undefined, bookingSnapshot: undefined, payments: [], refunds: [] };
      return res.json({ success: true, data: { bookingStatus: booking.status, venueName: venue?.venueName || "", guestName: booking.guestDetails?.fullName || booking.guestName || "Guest", record: safe, summary, canFinance,
        confirmation: canFinance ? confirmationText(booking, record, venue.venueName) : null,
        sessions: (await attendanceForBookings([booking]))[0].attendance.sessions } });
    } catch (error) { return handleError(res, error); }
  },
  update: async (req, res) => {
    try {
      const { eventCenterId } = req.body;
      if (!mongoose.Types.ObjectId.isValid(eventCenterId)) return res.status(400).json({ message: "Invalid venue." });
      const access = await authorize(req.user.id, eventCenterId, false);
      if (!access.authorized) return res.status(403).json({ message: access.error });
      const venue = await Venue.findById(eventCenterId).lean();
      if ((["PAYMENT", "REFUND_APPROVE", "REFUND_CONFIRM"].includes(req.body.action) || req.body.paymentDueDate !== undefined) && !await financeAccess(req.user.id, venue)) return res.status(403).json({ message: "Finance access is required." });
      const booking = await loadBooking(eventCenterId, req.params.bookingId);
      if (req.body.action === "HANDOVER") {
        const attendance = (await attendanceForBookings([booking]))[0].attendance;
        if (!attendance.sessions.some(s => s.sessionId === req.body.sessionId && s.status === "ATTENDED")) return res.status(400).json({ message: "Mark this session attended before recording checkout." });
      }
      if (req.body.guestCount > venue.capacity?.max) return res.status(400).json({ message: "Guest count exceeds venue capacity." });
      const saved = await saveOperation(eventCenterId, booking, req.body, req.user.id);
      return res.json({ success: true, data: { revision: saved.revision } });
    } catch (error) { return handleError(res, error); }
  },
});
