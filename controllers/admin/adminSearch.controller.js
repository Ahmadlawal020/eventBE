const User = require("../../models/user/user.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const EventBooking = require("../../models/user/eventBooking.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");

const globalSearch = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(200).json({
        success: true,
        data: { users: [], events: [], venues: [], bookings: [] },
      });
    }

    const searchRegex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const limit = 5;

    const [users, events, venues, eventBookings, venueBookings] = await Promise.all([
      User.find({
        $or: [
          { firstName: searchRegex },
          { surname: searchRegex },
          { email: searchRegex },
        ],
      })
        .select("firstName surname email roles profilePicture")
        .limit(limit)
        .lean(),

      Event.find({
        $or: [
          { title: searchRegex },
          { shortDescription: searchRegex },
        ],
      })
        .select("title status images createdBy")
        .populate("createdBy", "firstName surname")
        .limit(limit)
        .lean(),

      EventCenter.find({
        $or: [
          { venueName: searchRegex },
          { shortDescription: searchRegex },
        ],
      })
        .select("venueName status images createdBy")
        .populate("createdBy", "firstName surname")
        .limit(limit)
        .lean(),

      EventBooking.find({ paymentReference: searchRegex })
        .populate("buyer", "firstName surname email")
        .populate("eventId", "title")
        .select("buyer eventId paymentReference paymentStatus totalAmount currency createdAt")
        .limit(limit)
        .lean(),

      EventCenterBooking.find({ paymentReference: searchRegex })
        .populate("buyer", "firstName surname email")
        .populate("eventCenter", "venueName")
        .select("buyer eventCenter paymentReference paymentStatus totalPrice createdAt")
        .limit(limit)
        .lean(),
    ]);

    const bookings = [
      ...eventBookings.map((b) => ({ ...b, bookingType: "event" })),
      ...venueBookings.map((b) => ({ ...b, bookingType: "venue" })),
    ];

    res.status(200).json({
      success: true,
      data: {
        users: users.map((u) => ({ ...u, resultType: "user" })),
        events: events.map((e) => ({ ...e, resultType: "event" })),
        venues: venues.map((v) => ({ ...v, resultType: "venue" })),
        bookings: bookings.map((b) => ({ ...b, resultType: "booking" })),
      },
    });
  } catch (error) {
    console.error("[ADMIN GLOBAL SEARCH ERROR]", error);
    res.status(500).json({ success: false, message: "Server error performing search" });
  }
};

module.exports = { globalSearch };
