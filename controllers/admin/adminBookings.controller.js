const EventBooking = require("../../models/user/eventBooking.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

const getBookings = async (req, res) => {
  try {
    const { type = "all", paymentStatus, status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query = {};

    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (status) query.status = status;

    const tasks = [];

    if (type === "all" || type === "event") {
      tasks.push(
        EventBooking.find(query)
          .populate("buyer", "firstName surname email")
          .populate("eventId", "title createdBy")
          .sort({ createdAt: -1 })
          .skip(type === "event" ? skip : 0)
          .limit(Number(limit))
          .lean()
          .then((items) => items.map((item) => ({ ...item, bookingType: "event" }))),
      );
    }

    if (type === "all" || type === "event-center") {
      tasks.push(
        EventCenterBooking.find(query)
          .populate("buyer", "firstName surname email")
          .populate("organiser", "firstName surname email")
          .populate("eventCenter", "venueName createdBy")
          .sort({ createdAt: -1 })
          .skip(type === "event-center" ? skip : 0)
          .limit(Number(limit))
          .lean()
          .then((items) => items.map((item) => ({ ...item, bookingType: "event-center" }))),
      );
    }

    const [eventCount, venueCount, ...bookingGroups] = await Promise.all([
      type === "event-center" ? 0 : EventBooking.countDocuments(query),
      type === "event" ? 0 : EventCenterBooking.countDocuments(query),
      ...tasks,
    ]);

    const bookings = bookingGroups.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = eventCount + venueCount;

    res.status(200).json({
      success: true,
      data: {
        bookings: bookings.slice(0, Number(limit)),
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET BOOKINGS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching bookings" });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { status, paymentStatus, reason } = req.body;
    const Model = type === "event-center" ? EventCenterBooking : EventBooking;
    const targetType = type === "event-center" ? "EventCenterBooking" : "EventBooking";

    const booking = await Model.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const previousValue = {
      status: booking.status,
      paymentStatus: booking.paymentStatus,
    };

    if (status) booking.status = status;
    if (paymentStatus) booking.paymentStatus = paymentStatus;
    await booking.save();

    await recordAdminAction({
      req,
      action: "BOOKING_STATUS_UPDATED",
      targetType,
      targetId: booking._id,
      previousValue,
      newValue: {
        status: booking.status,
        paymentStatus: booking.paymentStatus,
      },
      metadata: { reason, bookingType: type },
    });

    res.status(200).json({ success: true, message: "Booking updated" });
  } catch (error) {
    console.error("[ADMIN UPDATE BOOKING STATUS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error updating booking" });
  }
};

// @desc Get single booking detail
// @route GET /api/admin/bookings/:type/:id
const getBookingDetail = async (req, res) => {
  try {
    const { type, id } = req.params;
    const Model = type === "event-center" ? EventCenterBooking : EventBooking;
    const targetType = type === "event-center" ? "EventCenterBooking" : "EventBooking";

    const booking = await Model.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    if (type === "event") {
      await Model.populate(booking, { path: "eventId", select: "title status images location createdBy", populate: { path: "createdBy", select: "firstName surname email" } });
    } else {
      await Model.populate(booking, [
        { path: "organiser", select: "firstName surname email" },
        { path: "eventCenter", select: "venueName status images location createdBy", populate: { path: "createdBy", select: "firstName surname email" } },
      ]);
    }

    res.status(200).json({
      success: true,
      data: {
        booking: { ...booking, bookingType: type },
        targetType,
      },
    });
  } catch (error) {
    console.error("[ADMIN GET BOOKING DETAIL ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching booking detail" });
  }
};

module.exports = {
  getBookings,
  getBookingDetail,
  updateBookingStatus,
};
