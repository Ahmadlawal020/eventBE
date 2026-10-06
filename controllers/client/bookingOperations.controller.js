const mongoose = require("mongoose");
const Venue = require("../../models/client/eventCenter.schema");
const Booking = require("../../models/client/eventCenterBooking.schema");
const Operations = require("../../models/client/bookingOperations.schema");
const { loadBooking, attendanceForBookings, dayOf } = require("../../services/bookingAttendance.service");
const { getManualBookings } = require("../../services/manualBookingRead.service");
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
  holds: async (req, res) => {
    try {
      const venueId = req.params.eventCenterId;
      if (!mongoose.Types.ObjectId.isValid(venueId)) return res.status(400).json({ message: "Invalid venue." });
      const access = await authorize(req.user.id, venueId, false);
      if (!access.authorized) return res.status(403).json({ message: access.error });
      const data = await require("../../models/client/venueHold.schema").find({ eventCenter: venueId }).sort({ createdAt: -1 }).limit(100).lean();
      return res.json({ success: true, data });
    } catch (error) { return handleError(res, error); }
  },
  changeHold: async (req, res) => {
    try {
      const venueId = req.params.eventCenterId;
      if (!mongoose.Types.ObjectId.isValid(venueId)) return res.status(400).json({ message: "Invalid venue." });
      const access = await authorize(req.user.id, venueId, false);
      if (!access.authorized) return res.status(403).json({ message: access.error });
      const service = require("../../services/venueHold.service");
      if (req.body.action && !["CONFIRM", "RELEASE"].includes(req.body.action)) return res.status(400).json({ message: "Invalid action." });
      const data = req.params.holdId
        ? await service.resolveHold(venueId, req.params.holdId, req.body.action, req.user.id, req.body.totalPrice)
        : await service.createHold(venueId, req.body, req.user.id);
      return res.json({ success: true, data });
    } catch (error) { return handleError(res, error); }
  },
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
      const safe = canFinance ? record : { ...record, openingPaidMinor: undefined, payments: [] };
      return res.json({ success: true, data: { record: safe, summary, canFinance,
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
      if ((req.body.action === "PAYMENT" || req.body.paymentDueDate !== undefined) && !await financeAccess(req.user.id, venue)) return res.status(403).json({ message: "Finance access is required." });
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
  today: async (req, res) => {
    try {
      const { eventCenterId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(eventCenterId)) return res.status(400).json({ message: "Invalid venue." });
      const access = await authorize(req.user.id, eventCenterId);
      if (!access.authorized) return res.status(403).json({ message: access.error });
      const venue = await Venue.findById(eventCenterId).lean();
      const [platform, manual, records] = await Promise.all([
        Booking.find({ eventCenter: eventCenterId, status: { $in: ["ACTIVE", "CONFIRMED", "COMPLETED"] } }).lean(),
        getManualBookings([venue]), Operations.find({ eventCenter: eventCenterId }).lean(),
      ]);
      const bookings = await attendanceForBookings([...platform, ...manual.filter(b => b.status !== "CANCELLED")]);
      const today = dayOf(new Date());
      const canFinance = await financeAccess(req.user.id, venue);
      const data = bookings.map(booking => {
        const record = records.find(r => r.bookingId === String(booking._id)) || {};
        return { bookingId: String(booking._id), guestName: booking.guestName || booking.guestDetails?.fullName || "Guest",
          bookingType: booking.bookingType || "PLATFORM", sessions: booking.attendance.sessions,
          handovers: record.handovers || [], paymentDueDate: record.paymentDueDate,
          summary: canFinance ? paymentSummary(booking, record) : null };
      });
      return res.json({ success: true, data: { today, venueName: venue.venueName, canFinance, bookings: data } });
    } catch (error) { return handleError(res, error); }
  },
});
