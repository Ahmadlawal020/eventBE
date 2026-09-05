const mongoose = require("mongoose");
const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const User = require("../../models/client/user.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const {
  recordAdminAction,
} = require("../../services/management/adminAudit.service");

const BOOKING_STATUSES = {
  event: ["ACTIVE", "CANCELLED", "COMPLETED"],
  "event-center": [
    "ACTIVE",
    "CANCELLED",
    "COMPLETED",
    "PENDING_REVIEW",
    "CONFIRMED",
  ],
};

const PAYMENT_STATUSES = {
  event: ["PENDING", "COMPLETED", "FAILED", "REFUNDED"],
  "event-center": [
    "PENDING",
    "COMPLETED",
    "FAILED",
    "REFUNDED",
    "FAILED_REFUND",
  ],
};

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const positiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return maximum ? Math.min(parsed, maximum) : parsed;
};

const venueBookingMetrics = async () => {
  const [metrics = {}] = await EventCenterBooking.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pendingReview: {
          $sum: { $cond: [{ $eq: ["$status", "PENDING_REVIEW"] }, 1, 0] },
        },
        confirmed: {
          $sum: {
            $cond: [{ $in: ["$status", ["ACTIVE", "CONFIRMED"]] }, 1, 0],
          },
        },
        completed: {
          $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
        },
        cancelled: {
          $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] },
        },
        paid: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, 1, 0] },
        },
        pendingPayment: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "PENDING"] }, 1, 0] },
        },
        refunded: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, 1, 0] },
        },
        checkedIn: { $sum: { $cond: ["$checkIn.isCheckedIn", 1, 0] } },
        revenue: {
          $sum: {
            $cond: [
              { $eq: ["$paymentStatus", "COMPLETED"] },
              { $ifNull: ["$totalPrice.amount", 0] },
              0,
            ],
          },
        },
      },
    },
  ]);

  return {
    total: metrics.total || 0,
    pendingReview: metrics.pendingReview || 0,
    confirmed: metrics.confirmed || 0,
    completed: metrics.completed || 0,
    cancelled: metrics.cancelled || 0,
    paid: metrics.paid || 0,
    pendingPayment: metrics.pendingPayment || 0,
    refunded: metrics.refunded || 0,
    checkedIn: metrics.checkedIn || 0,
    revenue: metrics.revenue || 0,
  };
};

const getBookings = async (req, res) => {
  try {
    const {
      type = "all",
      paymentStatus,
      status,
      bookingMode,
      checkInStatus,
      dateRange,
      search,
      sort = "newest",
    } = req.query;
    if (!["all", "event", "event-center"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking type" });
    }

    const page = positiveInteger(req.query.page, 1);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const skip = (page - 1) * limit;
    const expression =
      typeof search === "string" && search.trim()
        ? new RegExp(escapeRegex(search.trim()), "i")
        : null;
    const [people, events, venues] = expression
      ? await Promise.all([
          User.find({
            $or: [
              { firstName: expression },
              { surname: expression },
              { email: expression },
            ],
          })
            .select("_id")
            .limit(250)
            .lean(),
          Event.find({ title: expression }).select("_id").limit(250).lean(),
          EventCenter.find({ venueName: expression })
            .select("_id")
            .limit(250)
            .lean(),
        ])
      : [[], [], []];
    const peopleIds = people.map((person) => person._id);
    const eventIds = events.map((event) => event._id);
    const venueIds = venues.map((venue) => venue._id);
    const requestedTypes = type === "all" ? ["event", "event-center"] : [type];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const resultGroups = await Promise.all(
      requestedTypes.map(async (bookingType) => {
        const Model =
          bookingType === "event-center" ? EventCenterBooking : EventBooking;
        const query = {};
        if (BOOKING_STATUSES[bookingType].includes(status))
          query.status = status;
        if (PAYMENT_STATUSES[bookingType].includes(paymentStatus)) {
          query.paymentStatus = paymentStatus;
        }
        if (expression) {
          query.$or = [
            { "guestDetails.fullName": expression },
            { "guestDetails.email": expression },
            { paymentReference: expression },
            { paystackReference: expression },
            { buyer: { $in: peopleIds } },
          ];
          if (bookingType === "event-center") {
            query.$or.push(
              { ticketNumber: expression },
              { organiser: { $in: peopleIds } },
              { eventCenter: { $in: venueIds } },
            );
          } else {
            query.$or.push({ eventId: { $in: eventIds } });
          }
        }

        if (bookingType === "event-center") {
          if (["INSTANT", "REVIEW"].includes(bookingMode))
            query.bookingMode = bookingMode;
          if (checkInStatus === "checked_in")
            query["checkIn.isCheckedIn"] = true;
          if (checkInStatus === "not_checked_in") {
            query["checkIn.isCheckedIn"] = { $ne: true };
          }
          if (dateRange === "today") {
            query["selectedDates.date"] = { $gte: today, $lt: tomorrow };
          }
          if (dateRange === "upcoming")
            query["selectedDates.date"] = { $gte: today };
          if (dateRange === "past")
            query["selectedDates.date"] = { $lt: today };
        }

        const sortOptions = {
          newest: { createdAt: -1 },
          oldest: { createdAt: 1 },
          date_soon:
            bookingType === "event-center"
              ? { "selectedDates.date": 1 }
              : { createdAt: -1 },
          amount_high:
            bookingType === "event-center"
              ? { "totalPrice.amount": -1 }
              : { totalAmount: -1 },
        };
        const population =
          bookingType === "event-center"
            ? [
                {
                  path: "buyer",
                  select: "firstName surname email phoneNumber profilePicture",
                },
                { path: "organiser", select: "firstName surname email" },
                {
                  path: "eventCenter",
                  select:
                    "venueName status images location capacity bookingSettings basePrice createdBy",
                },
              ]
            : [
                {
                  path: "buyer",
                  select: "firstName surname email phoneNumber profilePicture",
                },
                {
                  path: "eventId",
                  select: "title status images location schedule createdBy",
                },
              ];

        const [items, count] = await Promise.all([
          Model.find(query)
            .select("-qrPayload")
            .populate(population)
            .sort(sortOptions[sort] || sortOptions.newest)
            .skip(type === "all" ? 0 : skip)
            .limit(limit)
            .lean(),
          Model.countDocuments(query),
        ]);
        return {
          count,
          items: items.map((item) => ({ ...item, bookingType })),
        };
      }),
    );

    const metrics = await venueBookingMetrics();
    const bookings = resultGroups.flatMap((group) => group.items);
    if (type === "all") {
      bookings.sort(
        (left, right) => new Date(right.createdAt) - new Date(left.createdAt),
      );
    }
    const total = resultGroups.reduce((sum, group) => sum + group.count, 0);

    res.status(200).json({
      success: true,
      data: {
        bookings: bookings.slice(0, limit),
        metrics: { eventCenters: metrics },
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET BOOKINGS ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching bookings" });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { status, paymentStatus, reason } = req.body;
    if (!["event", "event-center"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking type" });
    }
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking ID" });
    }
    if (status && !BOOKING_STATUSES[type].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking status" });
    }
    if (paymentStatus && !PAYMENT_STATUSES[type].includes(paymentStatus)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment status" });
    }
    if (!status && !paymentStatus) {
      return res
        .status(400)
        .json({ success: false, message: "No status update provided" });
    }
    const Model = type === "event-center" ? EventCenterBooking : EventBooking;
    const targetType =
      type === "event-center" ? "EventCenterBooking" : "EventBooking";

    const booking = await Model.findById(id);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
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
    res
      .status(500)
      .json({ success: false, message: "Server error updating booking" });
  }
};

// @desc Get single booking detail
// @route GET /api/admin/bookings/:type/:id
const getBookingDetail = async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!["event", "event-center"].includes(type)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking type" });
    }
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking ID" });
    }
    const Model = type === "event-center" ? EventCenterBooking : EventBooking;
    const targetType =
      type === "event-center" ? "EventCenterBooking" : "EventBooking";

    const booking = await Model.findById(id)
      .select("-qrPayload")
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("checkIn.checkedInBy", "firstName surname email")
      .populate("transferHistory.fromUser", "firstName surname email")
      .populate("transferHistory.toUser", "firstName surname email")
      .lean();

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    if (type === "event") {
      await Model.populate(booking, {
        path: "eventId",
        select: "title status images location createdBy",
        populate: { path: "createdBy", select: "firstName surname email" },
      });
    } else {
      await Model.populate(booking, [
        { path: "organiser", select: "firstName surname email" },
        {
          path: "eventCenter",
          select: "venueName status images location createdBy",
          populate: { path: "createdBy", select: "firstName surname email" },
        },
      ]);
    }

    res.status(200).json({
      success: true,
      data: {
        booking: {
          ...booking,
          bookingType: type,
          hasQrPayload: Boolean(
            await Model.exists({
              _id: booking._id,
              qrPayload: { $exists: true, $ne: "" },
            }),
          ),
        },
        targetType,
      },
    });
  } catch (error) {
    console.error("[ADMIN GET BOOKING DETAIL ERROR]", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching booking detail",
    });
  }
};

module.exports = {
  getBookings,
  getBookingDetail,
  updateBookingStatus,
};
