const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
const mongoose = require("mongoose");

/**
 * Check if a proposed hourly slot overlaps with existing booked slots
 */
function hasSlotConflict(newSlot, existingSlots, excludeBookingId) {
  const newDateStr = new Date(newSlot.date).toISOString().split("T")[0];
  const newStart = newSlot.startTime;
  const newEnd = newSlot.endTime;

  return existingSlots.some((existing) => {
    const existingDateStr = new Date(existing.date).toISOString().split("T")[0];
    if (existingDateStr !== newDateStr) return false;
    if (excludeBookingId && String(existing.bookingId) === String(excludeBookingId)) return false;
    if (existing.type !== "BOOKED" && existing.type !== "MANUAL") return false;
    return newStart < existing.endTime && newEnd > existing.startTime;
  });
}

/**
 * Authorization helper: check if user can manage bookings for an event center
 * Owner: always has access
 * Co-organiser: MANAGE_BOOKINGS, ALL_ACCESS, or VIEW_CALENDAR
 * Staff: MANAGE_BOOKINGS
 */
async function authorizeBookingAccess(userId, eventCenterId) {
  const eventCenter = await EventCenter.findById(eventCenterId);
  if (!eventCenter) return { authorized: false, error: "Event center not found" };

  // Owner always has access
  if (String(eventCenter.createdBy) === userId) return { authorized: true };

  // Co-organiser with MANAGE_BOOKINGS, ALL_ACCESS, or VIEW_CALENDAR
  const coHostInvite = await CoHostInvitation.findOne({
    coHost: userId,
    host: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: { $in: ["MANAGE_BOOKINGS", "ALL_ACCESS", "VIEW_CALENDAR"] }
  });
  if (coHostInvite) return { authorized: true };

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

    // Since EventCenterTickets have an array of selectedDates, we filter based on the last date in the array
    if (timeFilter === "upcoming") {
      query["selectedDates.date"] = { $gte: new Date(new Date().setHours(0, 0, 0, 0)) };
    } else if (timeFilter === "past") {
      query["selectedDates.date"] = { $lt: new Date(new Date().setHours(0, 0, 0, 0)) };
    }

    const skip = (page - 1) * limit;

    const bookings = await EventCenterTicket.find(query)
      .populate("buyer", "firstName lastName email avatar")
      .sort({ "selectedDates.0.date": 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await EventCenterTicket.countDocuments(query);

    res.status(200).json({
      success: true,
      data: bookings,
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

    const booking = await EventCenterTicket.findById(bookingId).populate("buyer", "firstName surname email avatar phoneNumber");

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const auth = await authorizeBookingAccess(req.user.id, booking.eventCenter);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    res.status(200).json({
      success: true,
      data: booking,
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

    // Try finding by exact ticket number first
    let bookings = await EventCenterTicket.find({
      eventCenter: eventCenterId,
      ticketNumber: { $regex: query, $options: "i" },
    }).populate("buyer", "firstName surname email avatar");

    if (bookings.length === 0) {
      // If not found by ticket number, search by guest details (name, email)
      bookings = await EventCenterTicket.find({
        eventCenter: eventCenterId,
        $or: [
          { "guestDetails.fullName": { $regex: query, $options: "i" } },
          { "guestDetails.email": { $regex: query, $options: "i" } },
        ],
      }).populate("buyer", "firstName surname email avatar");
    }

    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (error) {
    console.error("Error searching booking:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * Manually check in a guest for a booking
 */
exports.manualCheckIn = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const staffId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await EventCenterTicket.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const auth = await authorizeBookingAccess(req.user.id, booking.eventCenter);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    if (booking.status !== "ACTIVE") {
      return res.status(400).json({ success: false, message: `Cannot check in. Booking is ${booking.status}.` });
    }

    if (booking.checkIn && booking.checkIn.isCheckedIn) {
      return res.status(400).json({ success: false, message: "Guest is already checked in." });
    }

    booking.checkIn = {
      isCheckedIn: true,
      checkedInAt: new Date(),
      checkedInBy: staffId,
      method: "MANUAL",
    };

    await booking.save();

    res.status(200).json({
      success: true,
      message: "Guest successfully checked in manually.",
      data: booking,
    });
  } catch (error) {
    console.error("Error checking in guest manually:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * Cancel a booking
 */
exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await EventCenterTicket.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const auth = await authorizeBookingAccess(req.user.id, booking.eventCenter);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    if (booking.status === "CANCELLED") {
      return res.status(400).json({ success: false, message: "Booking is already cancelled." });
    }

    if (booking.checkIn && booking.checkIn.isCheckedIn) {
      return res.status(400).json({ success: false, message: "Cannot cancel. Guest is already checked in." });
    }

    booking.status = "CANCELLED";
    await booking.save();

    // Remove booked dates/slots from event center's availability
    const eventCenter = await EventCenter.findById(booking.eventCenter);
    if (eventCenter) {
      if (booking.bookingUnit === "day") {
        // Use bookingId matching to avoid removing other bookings' dates
        eventCenter.availability.unavailableDates = (
          eventCenter.availability.unavailableDates || []
        ).filter((entry) => {
          return String(entry.bookingId) !== String(booking._id);
        });
      } else if (booking.bookingUnit === "hour") {
        // Remove matching slots from unavailableSlots
        eventCenter.availability.unavailableSlots = (
          eventCenter.availability.unavailableSlots || []
        ).filter((slot) => {
          return String(slot.bookingId) !== String(booking._id);
        });
      }
      await eventCenter.save();
    }

    res.status(200).json({
      success: true,
      message: "Booking successfully cancelled.",
      data: booking,
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
      status: "ACTIVE",
      "selectedDates.date": { $gte: startOfDay, $lte: endOfDay },
    };

    const totalExpectedToday = await EventCenterTicket.countDocuments(todaysBookingsQuery);

    const checkedInToday = await EventCenterTicket.countDocuments({
      ...todaysBookingsQuery,
      "checkIn.isCheckedIn": true,
    });

    const totalActiveBookings = await EventCenterTicket.countDocuments({
      eventCenter: eventCenterId,
      status: "ACTIVE"
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

    const booking = await EventCenterTicket.findById(bookingId);

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

    // Remove old dates/slots from availability
    if (booking.bookingUnit === "day") {
      const oldDateStrings = (booking.selectedDates || []).map(
        (d) => new Date(d.date).toISOString().split("T")[0]
      );
      eventCenter.availability.unavailableDates = (
        eventCenter.availability.unavailableDates || []
      ).filter((entry) => {
        const entryDateStr = new Date(entry.date).toISOString().split("T")[0];
        return !oldDateStrings.includes(entryDateStr);
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

    res.status(200).json({
      success: true,
      message: "Booking rescheduled successfully.",
      data: booking,
    });
  } catch (error) {
    console.error("Error rescheduling booking:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
