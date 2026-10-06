const mongoose = require("mongoose");
const Attendance = require("../../models/client/bookingAttendance.schema");
const { attendanceFor, saveAttendance } = require("../../services/bookingAttendance.service");

exports.handlers = authorize => ({
  get: async (req, res) => {
    try {
      const { eventCenterId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(eventCenterId)) return res.status(400).json({ success: false, message: "Invalid venue ID." });
      const access = await authorize(req.user.id, eventCenterId);
      if (!access.authorized) return res.status(403).json({ success: false, message: access.error });
      const manage = await authorize(req.user.id, eventCenterId, false);
      const venue = await require("../../models/client/eventCenter.schema").findById(eventCenterId).lean();
      const [platform, manual, records] = await Promise.all([
        require("../../models/client/eventCenterBooking.schema").find({ eventCenter: eventCenterId }).select("_id selectedDates bookingUnit status checkIn").lean(),
        require("../../services/manualBookingRead.service").getManualBookings([venue]),
        Attendance.find({ eventCenter: eventCenterId }).populate("audit.actor", "firstName surname").lean(),
      ]);
      const bookings = {};
      for (const booking of [...platform, ...manual]) {
        const id = String(booking._id);
        bookings[id] = attendanceFor(booking, records.filter(record => record.bookingId === id));
      }
      return res.json({ success: true, data: { bookings, canManage: manage.authorized && req.user.roles?.includes("organiser") } });
    } catch (error) {
      console.error("[BOOKING ATTENDANCE]", error);
      return res.status(500).json({ success: false, message: "Could not load attendance." });
    }
  },
  update: async (req, res) => {
    try {
      const { eventCenterId } = req.body;
      if (!mongoose.Types.ObjectId.isValid(eventCenterId)) return res.status(400).json({ success: false, message: "Invalid venue ID." });
      const access = await authorize(req.user.id, eventCenterId, false);
      if (!access.authorized) return res.status(403).json({ success: false, message: access.error });
      const { sessionId, status, expectedRevision, reason, proofVerified } = req.body;
      const data = await saveAttendance({ eventCenterId, bookingId: req.params.bookingId, sessionId, status, expectedRevision, reason, proofVerified, actor: req.user.id });
      return res.json({ success: true, data });
    } catch (error) {
      if (!error.status) console.error("[UPDATE ATTENDANCE]", error);
      return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Could not save attendance." });
    }
  },
});
