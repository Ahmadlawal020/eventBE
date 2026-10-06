const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const StaffInvitation = require("../../models/client/staffInvitation.schema");
const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
const mongoose = require("mongoose");
const { hasSlotConflict } = require("../../utils/slotConflict");
const { logBookingHistory } = require("./bookingHistory.controller");

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Authorization helper: check if user can manage bookings for an event center
 * Owner: always has access
 * Co-organiser: MANAGE_BOOKINGS, ALL_ACCESS, or VIEW_CALENDAR
 * Staff: MANAGE_BOOKINGS
 */
async function authorizeBookingAccess(userId, eventCenterId, allowCalendarView = true) {
  const eventCenter = await EventCenter.findById(eventCenterId);
  if (!eventCenter) return { authorized: false, error: "Event center not found" };

  // Owner always has access
  if (String(eventCenter.createdBy) === userId) return { authorized: true };

  // Co-organiser with MANAGE_BOOKINGS, ALL_ACCESS, or VIEW_CALENDAR
  const coOrganiserInvite = await CoOrganiserInvitation.findOne({
    coOrganiser: userId,
    host: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: { $in: allowCalendarView ? ["MANAGE_BOOKINGS", "ALL_ACCESS", "VIEW_CALENDAR"] : ["MANAGE_BOOKINGS", "ALL_ACCESS"] }
  });
  if (coOrganiserInvite) return { authorized: true };

  // Staff with MANAGE_BOOKINGS
  const staffInvite = await StaffInvitation.findOne({
    staff: userId,
    organiser: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: "MANAGE_BOOKINGS"
  });
  if (staffInvite) return { authorized: true };

  return { authorized: false, error: "Not authorized to manage this booking" };
}

/**
 * Get all bookings for an event center, optionally filtered by status or date
 */
exports.getEventCenterBookings = async (req, res) => {
  try {
    const { eventCenterId } = req.params;
    const { status, page = 1, limit = 20, timeFilter } = req.query;

    if (!mongoose.Types.ObjectId.isValid(eventCenterId)) {
      return res.status(400).json({ success: false, message: "Invalid event center ID." });
    }

    const auth = await authorizeBookingAccess(req.user.id, eventCenterId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const query = { eventCenter: eventCenterId };

    if (status) {
      query.status = status;
    }

    // Since EventCenterBookings have an array of selectedDates, we filter based on the last date in the array
    if (timeFilter === "upcoming") {
      query["selectedDates.date"] = { $gte: new Date(new Date().setHours(0, 0, 0, 0)) };
    } else if (timeFilter === "past") {
      query["selectedDates.date"] = { $lt: new Date(new Date().setHours(0, 0, 0, 0)) };
    }

    const skip = (page - 1) * limit;

    const bookings = await EventCenterBooking.find(query)
      .populate("buyer", "firstName surname email avatar")
      .sort({ "selectedDates.0.date": 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await EventCenterBooking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: await require("../../services/bookingAttendance.service").withCurrentCheckIns(bookings),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * Get details of a specific booking
 */
exports.getBookingDetails = async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await EventCenterBooking.findById(bookingId).populate("buyer", "firstName surname email avatar phoneNumber");

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const auth = await authorizeBookingAccess(req.user.id, booking.eventCenter);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    res.status(200).json({
      success: true,
      data: (await require("../../services/bookingAttendance.service").withCurrentCheckIns([booking]))[0],
    });
  } catch (error) {
    console.error("Error fetching booking details:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * Search bookings by ticket number, guest name, or email
 */
exports.searchBooking = async (req, res) => {
  try {
    const { eventCenterId } = req.params;
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ success: false, message: "Search query is required." });
    }

    if (!mongoose.Types.ObjectId.isValid(eventCenterId)) {
      return res.status(400).json({ success: false, message: "Invalid event center ID." });
    }

    const auth = await authorizeBookingAccess(req.user.id, eventCenterId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const safeQuery = escapeRegex(query);

    // Try finding by exact ticket number first
    let bookings = await EventCenterBooking.find({
      eventCenter: eventCenterId,
      ticketNumber: { $regex: safeQuery, $options: "i" },
    }).populate("buyer", "firstName surname email avatar");

    if (bookings.length === 0) {
      // If not found by ticket number, search by guest details (name, email)
      bookings = await EventCenterBooking.find({
        eventCenter: eventCenterId,
        $or: [
          { "guestDetails.fullName": { $regex: safeQuery, $options: "i" } },
          { "guestDetails.email": { $regex: safeQuery, $options: "i" } },
        ],
      }).populate("buyer", "firstName surname email avatar");
    }

    res.status(200).json({
      success: true,
      data: await require("../../services/bookingAttendance.service").withCurrentCheckIns(bookings),
    });
  } catch (error) {
    console.error("Error searching booking:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * Manually check in a guest for a booking (atomic)
 */
exports.manualCheckIn = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const staffId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await EventCenterBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    if (req.body?.eventCenterId && String(booking.eventCenter) !== req.body.eventCenterId) {
      return res.status(404).json({ success: false, message: "Booking not found for this venue." });
    }
    const auth = await authorizeBookingAccess(req.user.id, booking.eventCenter, false);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const attendance = await require("../../services/bookingAttendance.service").checkInCurrentSession({
      booking, eventCenterId: String(booking.eventCenter), actor: staffId,
      proofVerified: true,
    });
    return res.status(200).json({ success: true, message: "Guest checked in for this session.",
      data: { ...booking.toObject(), checkIn: { isCheckedIn: true, checkedInAt: attendance.recordedAt }, attendance } });
  } catch (error) {
    console.error("Error checking in guest manually:", error);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Server error." });
  }
};

// The organiser action now requires an explicit session; old clients cannot
// accidentally mark every date in a grouped booking as attended.
const attendanceHandlers = () => require("./bookingAttendance.controller").handlers(authorizeBookingAccess);
exports.getVenueAttendance = (req, res) => attendanceHandlers().get(req, res);
exports.updateBookingAttendance = (req, res) => attendanceHandlers().update(req, res);
exports.organiserManualCheckIn = (req, res) => attendanceHandlers().update(req, res);

/** Authoritative check-in state, shared by the calendar and upcoming list. */
exports.getVenueCheckIns = async (req, res) => {
  try {
    const { eventCenterId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventCenterId)) return res.status(400).json({ success: false, message: "Invalid venue ID." });
    const access = await authorizeBookingAccess(req.user.id, eventCenterId);
    if (!access.authorized) return res.status(403).json({ success: false, message: access.error });
    const manageAccess = await authorizeBookingAccess(req.user.id, eventCenterId, false);
    const venue = await EventCenter.findById(eventCenterId).lean();
    const [platform, manual] = await Promise.all([
      EventCenterBooking.find({ eventCenter: eventCenterId }).lean(),
      require("../../services/manualBookingRead.service").getManualBookings([venue]),
    ]);
    const current = await require("../../services/bookingAttendance.service").withCurrentCheckIns([...platform, ...manual]);
    const bookings = Object.fromEntries(current.map(booking => [String(booking._id), booking.checkIn]));
    return res.json({ success: true, data: { bookings, canCheckIn: manageAccess.authorized && req.user.roles?.includes("organiser") } });
  } catch (error) {
    console.error("[VENUE CHECK-INS]", error);
    return res.status(500).json({ success: false, message: "Could not load check-in status." });
  }
};

/**
 * Cancel a booking
 */
exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await EventCenterBooking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const auth = await authorizeBookingAccess(req.user.id, booking.eventCenter, false);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    if (booking.status === "CANCELLED") {
      return res.status(400).json({ success: false, message: "Booking is already cancelled." });
    }

    // PENDING_REVIEW bookings must go through declineBooking (handles refund properly)
    if (booking.status === "PENDING_REVIEW") {
      return res.status(400).json({
        success: false,
        message: "PENDING_REVIEW bookings must be declined, not cancelled. Use the decline endpoint.",
      });
    }

    const attendance = (await require("../../services/bookingAttendance.service").attendanceForBookings([booking.toObject()]))[0].attendance;
    if (attendance.summary.attended > 0) {
      return res.status(400).json({ success: false, message: "Cannot cancel. Guest is already checked in." });
    }

    const refundMinor = booking.paymentStatus === "COMPLETED" && booking.paymentReference ? Math.round(booking.totalPrice.amount * 100) : 0;
    if (req.body.expectedRefundMinor !== undefined && req.body.expectedRefundMinor !== refundMinor) return res.status(409).json({ success: false, message: "The refund amount changed. Review the cancellation details again." });

    booking.status = "CANCELLED";

    // Refund payment if it was completed
    if (booking.paymentStatus === "COMPLETED" && booking.paymentReference) {
      try {
        const { getPaymentGateway } = require("../../services/payment");
        const gw = getPaymentGateway();
        await gw.refundPayment(booking.paymentReference);
        booking.paymentStatus = "REFUNDED";
      } catch (refundErr) {
        console.error("[CANCEL BOOKING] Refund failed:", refundErr.message);
        booking.paymentStatus = "FAILED_REFUND";
      }
    }

    await booking.save();

    // Remove booked dates/slots from event center's availability
    const eventCenter = await EventCenter.findById(booking.eventCenter);
    if (eventCenter) {
      if (booking.bookingUnit === "day") {
        eventCenter.availability.unavailableDates = (
          eventCenter.availability.unavailableDates || []
        ).filter((entry) => {
          return String(entry.bookingId) !== String(booking._id);
        });
      } else if (booking.bookingUnit === "hour") {
        eventCenter.availability.unavailableSlots = (
          eventCenter.availability.unavailableSlots || []
        ).filter((slot) => {
          return String(slot.bookingId) !== String(booking._id);
        });
      }
      await eventCenter.save();
    }

    // Log booking history
    logBookingHistory({
      eventCenter: booking.eventCenter,
      ticket: booking._id,
      bookingId: String(booking._id),
      bookingType: "PLATFORM",
      bookingUnit: booking.bookingUnit,
      action: "CANCELLED",
      performedBy: req.user.id,
      dates: booking.selectedDates,
      guestName: booking.guestDetails?.fullName || "",
      reason: reason || undefined,
      totalPrice: booking.totalPrice,
    });

    res.status(200).json({
      success: true,
      message: booking.paymentStatus === "FAILED_REFUND" ? "Booking cancelled, but the refund needs support follow-up." : "Booking successfully cancelled.",
      data: (await require("../../services/bookingAttendance.service").withCurrentCheckIns([booking]))[0],
    });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * Get real-time stats for an event center (e.g. today's bookings, checked-in count)
 */
exports.getBookingStats = async (req, res) => {
  try {
    const { eventCenterId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventCenterId)) {
      return res.status(400).json({ success: false, message: "Invalid event center ID." });
    }

    const auth = await authorizeBookingAccess(req.user.id, eventCenterId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Get all bookings that include today in their selected dates
    const todaysBookingsQuery = {
      eventCenter: eventCenterId,
      status: { $in: ["ACTIVE", "CONFIRMED"] },
      "selectedDates.date": { $gte: startOfDay, $lte: endOfDay },
    };

    const totalExpectedToday = await EventCenterBooking.countDocuments(todaysBookingsQuery);

    const attendanceBookings = await require("../../services/bookingAttendance.service").attendanceForBookings(
      await EventCenterBooking.find(todaysBookingsQuery).lean());
    const today = require("../../services/bookingAttendance.service").bookingSessions({ bookingUnit: "day", selectedDates: [{ date: new Date() }] })[0].date;
    const checkedInToday = attendanceBookings.filter(b => b.attendance.sessions.some(session => session.date === today && session.status === "ATTENDED")).length;

    const totalActiveBookings = await EventCenterBooking.countDocuments({
      eventCenter: eventCenterId,
      status: { $in: ["ACTIVE", "CONFIRMED"] },
    });

    res.status(200).json({
      success: true,
      data: {
        totalExpectedToday,
        checkedInToday,
        pendingCheckIns: totalExpectedToday - checkedInToday,
        totalActiveBookings
      },
    });
  } catch (error) {
    console.error("Error getting booking stats:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * Reschedule a booking to new dates
 */
exports.rescheduleBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { newDates } = req.body;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    if (!newDates || !Array.isArray(newDates) || newDates.length === 0) {
      return res.status(400).json({ success: false, message: "New dates are required." });
    }

    const booking = await EventCenterBooking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const auth = await authorizeBookingAccess(req.user.id, booking.eventCenter);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    if (booking.status !== "ACTIVE") {
      return res.status(400).json({ success: false, message: "Can only reschedule active bookings." });
    }

    const eventCenter = await EventCenter.findById(booking.eventCenter);
    if (!eventCenter) {
      return res.status(404).json({ success: false, message: "Event center not found." });
    }

    // Validate new dates against existing availability
    if (booking.bookingUnit === "day") {
      const newDateStrings = newDates.map(
        (d) => new Date(d.date).toISOString().split("T")[0]
      );
      const dayConflicts = (eventCenter.availability.unavailableDates || []).filter((entry) => {
        const entryDateStr = new Date(entry.date).toISOString().split("T")[0];
        return newDateStrings.includes(entryDateStr) &&
               (entry.type === "BOOKED" || entry.type === "MANUAL") &&
               String(entry.bookingId) !== String(booking._id);
      });
      if (dayConflicts.length > 0) {
        return res.status(400).json({
          success: false,
          message: "One or more selected dates are already booked",
        });
      }
    } else if (booking.bookingUnit === "hour") {
      const existingSlots = eventCenter.availability.unavailableSlots || [];
      for (const slot of newDates) {
        if (hasSlotConflict(slot, existingSlots, booking._id)) {
          return res.status(400).json({
            success: false,
            message: "One or more selected time slots conflict with an existing booking",
          });
        }
      }
    }

    // Capture old dates for history before updating
    const previousDates = [...(booking.selectedDates || [])];

    // Remove old dates/slots from availability (filter by bookingId to avoid removing other bookings' dates)
    if (booking.bookingUnit === "day") {
      eventCenter.availability.unavailableDates = (
        eventCenter.availability.unavailableDates || []
      ).filter((entry) => {
        return String(entry.bookingId) !== String(booking._id);
      });
    } else if (booking.bookingUnit === "hour") {
      eventCenter.availability.unavailableSlots = (
        eventCenter.availability.unavailableSlots || []
      ).filter((slot) => String(slot.bookingId) !== String(booking._id));
    }

    // Update booking with new dates
    booking.selectedDates = newDates.map((d) => ({
      date: new Date(d.date),
      ...(d.startTime && { startTime: d.startTime }),
      ...(d.endTime && { endTime: d.endTime }),
    }));
    booking.duration = newDates.length;
    await booking.save();

    // Add new dates/slots to availability
    if (booking.bookingUnit === "day") {
      const newDateStrings = newDates.map(
        (d) => new Date(d.date).toISOString().split("T")[0]
      );
      newDateStrings.forEach((dateStr) => {
        eventCenter.availability.unavailableDates.push({
          date: new Date(dateStr),
          type: "BOOKED",
          bookingId: String(booking._id),
          clientName: booking.guestDetails?.fullName || "",
          clientPhone: booking.guestDetails?.phoneNumber || "",
          clientEmail: booking.guestDetails?.email || "",
        });
      });
    } else if (booking.bookingUnit === "hour") {
      newDates.forEach((slot) => {
        eventCenter.availability.unavailableSlots.push({
          date: new Date(slot.date),
          startTime: slot.startTime,
          endTime: slot.endTime,
          type: "BOOKED",
          bookingId: String(booking._id),
          clientName: booking.guestDetails?.fullName || "",
          clientPhone: booking.guestDetails?.phoneNumber || "",
          clientEmail: booking.guestDetails?.email || "",
        });
      });
    }
    await eventCenter.save();

    // Log booking history
    logBookingHistory({
      eventCenter: booking.eventCenter,
      ticket: booking._id,
      bookingId: String(booking._id),
      bookingType: "PLATFORM",
      bookingUnit: booking.bookingUnit,
      action: "RESCHEDULED",
      performedBy: req.user.id,
      dates: booking.selectedDates,
      previousDates: previousDates,
      guestName: booking.guestDetails?.fullName || "",
      totalPrice: booking.totalPrice,
    });

    res.status(200).json({
      success: true,
      message: "Booking rescheduled successfully.",
      data: (await require("../../services/bookingAttendance.service").withCurrentCheckIns([booking]))[0],
    });
  } catch (error) {
    console.error("Error rescheduling booking:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

const operationHandlers = () => require("./bookingOperations.controller").handlers(authorizeBookingAccess);
exports.getBookingOperations = (req, res) => operationHandlers().details(req, res);
exports.updateBookingOperations = (req, res) => operationHandlers().update(req, res);
exports.getVenueToday = (req, res) => operationHandlers().today(req, res);

exports.getVenueHolds = (req, res) => operationHandlers().holds(req, res);
exports.changeVenueHold = (req, res) => operationHandlers().changeHold(req, res);

exports.getCancellationPreview = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.bookingId)) return res.status(400).json({ message: "Invalid booking ID." });
    const booking = await EventCenterBooking.findById(req.params.bookingId).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    const access = await authorizeBookingAccess(req.user.id, booking.eventCenter, false);
    if (!access.authorized) return res.status(403).json({ message: access.error });
    const attendance = (await require("../../services/bookingAttendance.service").attendanceForBookings([booking]))[0].attendance;
    const canCancel = ["ACTIVE", "CONFIRMED"].includes(booking.status) && attendance.summary.attended === 0;
    return res.json({ success: true, data: { canCancel, currency: booking.totalPrice.currency,
      refundMinor: booking.paymentStatus === "COMPLETED" && booking.paymentReference ? Math.round(booking.totalPrice.amount * 100) : 0,
      paymentStatus: booking.paymentStatus,
      terms: "Cancelling a paid booking before attendance requests a full refund. Refund processing may require follow-up if the payment provider rejects it." } });
  } catch (error) { console.error("[CANCELLATION PREVIEW]", error); return res.status(500).json({ message: "Could not load cancellation details." }); }
};
