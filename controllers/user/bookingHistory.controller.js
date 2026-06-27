const BookingHistory = require("../../models/user/bookingHistory.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const mongoose = require("mongoose");

/**
 * Authorization helper — same pattern as staffBooking.controller
 */
async function authorizeBookingAccess(userId, eventCenterId) {
  const eventCenter = await EventCenter.findById(eventCenterId);
  if (!eventCenter) return { authorized: false, error: "Event center not found" };

  if (String(eventCenter.createdBy) === userId) return { authorized: true };

  const coOrganiserInvite = await CoOrganiserInvitation.findOne({
    coOrganiser: userId,
    host: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: { $in: ["MANAGE_BOOKINGS", "ALL_ACCESS", "VIEW_CALENDAR"] },
  });
  if (coOrganiserInvite) return { authorized: true };

  const staffInvite = await StaffInvitation.findOne({
    staff: userId,
    organiser: eventCenter.createdBy,
    status: "ACCEPTED",
    "listings.listingId": eventCenter._id,
    permissions: "MANAGE_BOOKINGS",
  });
  if (staffInvite) return { authorized: true };

  return { authorized: false, error: "Not authorized to view booking history" };
}

// ============================================================================
// INTERNAL HELPER — Call from other controllers to log actions
// ============================================================================
const logBookingHistory = async (data) => {
  try {
    await BookingHistory.create({
      eventCenter: data.eventCenter,
      ticket: data.ticket || null,
      bookingId: data.bookingId,
      bookingType: data.bookingType,
      bookingUnit: data.bookingUnit || "day",
      action: data.action,
      performedBy: data.performedBy,
      dates: data.dates || [],
      previousDates: data.previousDates || [],
      guestName: data.guestName || "",
      reason: data.reason || undefined,
      totalPrice: data.totalPrice || null,
    });
  } catch (err) {
    // Never block the main operation if logging fails
    console.error("[BOOKING HISTORY LOG ERROR]", err.message);
  }
};

// ============================================================================
// GET BOOKING HISTORY — Paginated, filterable
// ============================================================================
const getBookingHistory = async (req, res) => {
  const { eventCenterId } = req.params;
  const { action, bookingType, page = 1, limit = 20 } = req.query;

  try {
    const auth = await authorizeBookingAccess(req.user.id, eventCenterId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const query = { eventCenter: eventCenterId };
    if (action) query.action = action;
    if (bookingType) query.bookingType = bookingType;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [entries, total] = await Promise.all([
      BookingHistory.find(query)
        .populate("performedBy", "firstName surname")
        .populate("ticket", "ticketNumber")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      BookingHistory.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: entries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("[GET BOOKING HISTORY ERROR]", err);
    res.status(500).json({ success: false, message: "Server error fetching booking history" });
  }
};

// ============================================================================
// GET ALL BOOKING HISTORY — Across all venues for the organiser
// ============================================================================
const getAllBookingHistory = async (req, res) => {
  const { action, bookingType, page = 1, limit = 20 } = req.query;
  const organiserId = req.user.id;

  try {
    const venues = await EventCenter.find({
      $or: [
        { createdBy: organiserId },
        { coOrganisers: organiserId },
      ],
      staff: { $ne: organiserId },
    }).select("_id").lean();

    const venueIds = venues.map((v) => v._id);

    if (venueIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: parseInt(limit), totalPages: 0 },
      });
    }

    const query = { eventCenter: { $in: venueIds } };
    if (action) query.action = action;
    if (bookingType) query.bookingType = bookingType;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [entries, total] = await Promise.all([
      BookingHistory.find(query)
        .populate("performedBy", "firstName surname")
        .populate("ticket", "ticketNumber")
        .populate("eventCenter", "venueName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      BookingHistory.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: entries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("[GET ALL BOOKING HISTORY ERROR]", err);
    res.status(500).json({ success: false, message: "Server error fetching booking history" });
  }
};

// ============================================================================
// CREATE HISTORY ENTRY — For client-side logging (manual bookings)
// ============================================================================
const createHistoryEntry = async (req, res) => {
  const { eventCenterId, bookingId, bookingType, bookingUnit, action, dates, previousDates, guestName, totalPrice, reason } = req.body;

  try {
    if (!eventCenterId || !bookingId || !bookingType || !action) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const auth = await authorizeBookingAccess(req.user.id, eventCenterId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    await logBookingHistory({
      eventCenter: eventCenterId,
      bookingId,
      bookingType,
      bookingUnit: bookingUnit || "day",
      action,
      performedBy: req.user.id,
      dates: dates || [],
      previousDates: previousDates || [],
      guestName: guestName || "",
      reason: reason || undefined,
      totalPrice: totalPrice || null,
    });

    res.status(201).json({ success: true, message: "History entry logged" });
  } catch (err) {
    console.error("[CREATE BOOKING HISTORY ERROR]", err);
    res.status(500).json({ success: false, message: "Server error logging history" });
  }
};

// ============================================================================
// GET UNIFIED BOOKINGS — Unique bookings across all venues (platform + manual)
// ============================================================================
const getUnifiedBookings = async (req, res) => {
  const { status, bookingType, page = 1, limit = 20 } = req.query;
  const organiserId = req.user.id;

  try {
    const venues = await EventCenter.find({
      $or: [
        { createdBy: organiserId },
        { coOrganisers: organiserId },
      ],
      staff: { $ne: organiserId },
    }).select("_id venueName").lean();

    const venueIds = venues.map((v) => v._id);
    const venueMap = {};
    venues.forEach((v) => { venueMap[v._id.toString()] = v; });

    if (venueIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: parseInt(limit), totalPages: 0 },
      });
    }

    // 1. Fetch platform bookings (EventCenterBooking)
    const ticketQuery = { eventCenter: { $in: venueIds } };
    if (status) ticketQuery.status = status;

    const platformTickets = await EventCenterBooking.find(ticketQuery)
      .populate("eventCenter", "venueName")
      .sort({ createdAt: -1 })
      .lean();

    const platformBookings = platformTickets.map((t) => ({
      bookingId: String(t._id),
      bookingType: "PLATFORM",
      status: t.status,
      guestName: t.guestDetails?.fullName || "",
      guestEmail: t.guestDetails?.email || "",
      guestPhone: t.guestDetails?.phoneNumber || "",
      dates: t.selectedDates || [],
      totalPrice: t.totalPrice,
      bookingUnit: t.bookingUnit,
      duration: t.duration,
      paymentStatus: t.paymentStatus,
      ticketNumber: t.ticketNumber,
      checkIn: t.checkIn,
      eventCenter: t.eventCenter,
      bookingMode: t.bookingMode,
      reviewDeadline: t.reviewDeadline,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    // 2. Fetch manual bookings (BookingHistory with action CREATED, bookingType MANUAL)
    const manualCreatedQuery = {
      eventCenter: { $in: venueIds },
      bookingType: "MANUAL",
      action: "CREATED",
    };

    const manualCreatedEntries = await BookingHistory.find(manualCreatedQuery)
      .populate("eventCenter", "venueName")
      .sort({ createdAt: -1 })
      .lean();

    // Batch fetch latest entries for all manual bookings to avoid N+1 queries
    const manualBookingIds = manualCreatedEntries.map((e) => e.bookingId);

    const latestEntries = await BookingHistory.aggregate([
      { $match: { bookingId: { $in: manualBookingIds } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$bookingId", latestEntry: { $first: "$$ROOT" } } },
    ]);

    const latestEntryMap = {};
    latestEntries.forEach((e) => { latestEntryMap[e._id] = e.latestEntry; });

    const manualBookings = [];
    for (const entry of manualCreatedEntries) {
      const latestEntry = latestEntryMap[entry.bookingId];

      let currentStatus = "ACTIVE";
      if (latestEntry && latestEntry.action === "CANCELLED") {
        currentStatus = "CANCELLED";
      }

      // Apply status filter
      if (status && currentStatus !== status) continue;

      manualBookings.push({
        bookingId: entry.bookingId,
        bookingType: "MANUAL",
        bookingUnit: entry.bookingUnit || "day",
        status: currentStatus,
        guestName: entry.guestName || "",
        dates: entry.dates || [],
        totalPrice: entry.totalPrice,
        eventCenter: entry.eventCenter,
        createdAt: entry.createdAt,
        updatedAt: latestEntry ? latestEntry.createdAt : entry.createdAt,
      });
    }

    // 3. Merge and sort
    let allBookings = [...platformBookings, ...manualBookings];

    // Apply bookingType filter
    if (bookingType) {
      allBookings = allBookings.filter((b) => b.bookingType === bookingType);
    }

    // Sort by most recent activity
    allBookings.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    // Paginate
    const total = allBookings.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginated = allBookings.slice(skip, skip + parseInt(limit));

    res.status(200).json({
      success: true,
      data: paginated,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("[GET UNIFIED BOOKINGS ERROR]", err);
    res.status(500).json({ success: false, message: "Server error fetching bookings" });
  }
};

// ============================================================================
// GET BOOKING ACTIVITY — Full timeline for a specific booking
// ============================================================================
const getBookingActivity = async (req, res) => {
  const { bookingId } = req.params;

  try {
    // Find the booking to determine its event center for authorization
    let eventCenterId = null;

    // Try platform booking first
    const platformBooking = await EventCenterBooking.findById(bookingId).select("eventCenter").lean();
    if (platformBooking) {
      eventCenterId = platformBooking.eventCenter;
    } else {
      // Try manual booking via history
      const historyEntry = await BookingHistory.findOne({ bookingId }).select("eventCenter").lean();
      if (historyEntry) {
        eventCenterId = historyEntry.eventCenter;
      }
    }

    if (!eventCenterId) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const auth = await authorizeBookingAccess(req.user.id, eventCenterId);
    if (!auth.authorized) {
      return res.status(403).json({ success: false, message: auth.error });
    }

    const entries = await BookingHistory.find({ bookingId })
      .populate("performedBy", "firstName surname")
      .populate("eventCenter", "venueName")
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: entries,
    });
  } catch (err) {
    console.error("[GET BOOKING ACTIVITY ERROR]", err);
    res.status(500).json({ success: false, message: "Server error fetching booking activity" });
  }
};

// ============================================================================
// GET BOOKING FULL DETAILS — Booking info + activity timeline
// ============================================================================
const getBookingFullDetails = async (req, res) => {
  const { bookingId } = req.params;

  try {
    let booking = null;
    let isPlatform = false;
    let eventCenterId = null;

    // Determine if this is a platform booking (ObjectId) or manual booking
    if (mongoose.Types.ObjectId.isValid(bookingId)) {
      // Platform booking — fetch from EventCenterBooking
      booking = await EventCenterBooking.findById(bookingId)
        .populate("buyer", "firstName surname email phoneNumber")
        .populate("eventCenter", "venueName images location")
        .populate("checkIn.checkedInBy", "firstName surname")
        .lean();

      if (booking) {
        isPlatform = true;
        eventCenterId = booking.eventCenter?._id || booking.eventCenter;
      }
    }

    if (!booking) {
      // Manual booking — reconstruct from history
      const createdEntry = await BookingHistory.findOne({
        bookingId,
        action: "CREATED",
      })
        .populate("eventCenter", "venueName images location")
        .lean();

      if (!createdEntry) {
        return res.status(404).json({ success: false, message: "Booking not found" });
      }

      eventCenterId = createdEntry.eventCenter?._id || createdEntry.eventCenter;

      // Get latest entry for current status
      const latestEntry = await BookingHistory.findOne({ bookingId })
        .sort({ createdAt: -1 })
        .lean();

      let currentStatus = "ACTIVE";
      if (latestEntry && latestEntry.action === "CANCELLED") {
        currentStatus = "CANCELLED";
      }

      booking = {
        _id: bookingId,
        bookingType: "MANUAL",
        bookingUnit: createdEntry.bookingUnit || "day",
        status: currentStatus,
        guestName: createdEntry.guestName || "",
        dates: createdEntry.dates || [],
        totalPrice: createdEntry.totalPrice,
        eventCenter: createdEntry.eventCenter,
        createdAt: createdEntry.createdAt,
      };
    }

    // Authorization check
    if (eventCenterId) {
      const auth = await authorizeBookingAccess(req.user.id, eventCenterId);
      if (!auth.authorized) {
        return res.status(403).json({ success: false, message: auth.error });
      }
    }

    // Fetch activity timeline
    const activity = await BookingHistory.find({ bookingId })
      .populate("performedBy", "firstName surname")
      .sort({ createdAt: 1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        booking,
        activity,
        isPlatform,
      },
    });
  } catch (err) {
    console.error("[GET BOOKING FULL DETAILS ERROR]", err);
    res.status(500).json({ success: false, message: "Server error fetching booking details" });
  }
};

module.exports = {
  getBookingHistory,
  getAllBookingHistory,
  createHistoryEntry,
  logBookingHistory,
  getUnifiedBookings,
  getBookingActivity,
  getBookingFullDetails,
};
