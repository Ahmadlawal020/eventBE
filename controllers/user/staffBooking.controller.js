const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const mongoose = require("mongoose");

/**
 * Get all bookings for an event center, optionally filtered by status or date
 */
exports.getEventCenterBookings = async (req, res) => {
  try {
    const { eventCenterId } = req.params;
    const { status, page = 1, limit = 20, timeFilter } = req.query; // timeFilter: "upcoming" or "past"

    if (!mongoose.Types.ObjectId.isValid(eventCenterId)) {
      return res.status(400).json({ success: false, message: "Invalid event center ID." });
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

    const booking = await EventCenterTicket.findById(bookingId).populate("buyer", "firstName lastName email avatar phoneNumber");

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
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

    // Try finding by exact ticket number first
    let bookings = await EventCenterTicket.find({
      eventCenter: eventCenterId,
      ticketNumber: { $regex: query, $options: "i" },
    }).populate("buyer", "firstName lastName email avatar");

    if (bookings.length === 0) {
      // If not found by ticket number, search by guest details (name, email)
      bookings = await EventCenterTicket.find({
        eventCenter: eventCenterId,
        $or: [
          { "guestDetails.fullName": { $regex: query, $options: "i" } },
          { "guestDetails.email": { $regex: query, $options: "i" } },
        ],
      }).populate("buyer", "firstName lastName email avatar");
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
    const staffId = req.user.id; // From verifyJWT middleware

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    const booking = await EventCenterTicket.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
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

    if (booking.status === "CANCELLED") {
      return res.status(400).json({ success: false, message: "Booking is already cancelled." });
    }

    if (booking.checkIn && booking.checkIn.isCheckedIn) {
      return res.status(400).json({ success: false, message: "Cannot cancel. Guest is already checked in." });
    }

    booking.status = "CANCELLED";
    await booking.save();

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
