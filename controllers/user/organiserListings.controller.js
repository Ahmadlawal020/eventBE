const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");

/**
 * 📋 Get Aggregated Organiser Listings (My Events and My Event Centers)
 */
const getOrganiserListings = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const userId = req.user.id;

    // 1️⃣ Fetch Organiser's Events
    const events = await Event.find({ createdBy: userId })
      .select({
        title: 1,
        images: 1,
        status: 1,
        eventType: 1,
        location: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 });

    const formattedEvents = events.map((event) => {
      const obj = event.toJSON();
      return {
        _id: obj._id,
        title: obj.title,
        status: obj.status,
        eventTypeLabel: obj.eventTypeLabel,
        location: obj.location || null,
        images: obj.images || [],
        createdAt: obj.createdAt,
        type: "event",
      };
    });

    // 2️⃣ Fetch Organiser's Event Centers
    const eventCenters = await EventCenter.find({ createdBy: userId })
      .select({
        venueName: 1,
        images: 1,
        status: 1,
        venueType: 1,
        location: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 });

    const formattedEventCenters = eventCenters.map((center) => {
      const obj = center.toJSON();
      return {
        _id: obj._id,
        venueName: obj.venueName,
        status: obj.status,
        venueType: obj.venueType,
        location: obj.location || null,
        images: obj.images || [],
        createdAt: obj.createdAt,
        type: "event-center",
      };
    });

    // 3️⃣ Combine and Sort by newest first
    const allListings = [...formattedEvents, ...formattedEventCenters].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      success: true,
      message: "Organiser listings aggregated successfully",
      count: allListings.length,
      data: allListings,
    });
  } catch (err) {
    console.error("[GET ORGANISER LISTINGS] ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  getOrganiserListings,
};
