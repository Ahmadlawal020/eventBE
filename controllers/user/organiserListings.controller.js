const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");

/**
 * 📋 Get Aggregated Organiser Listings (My Events and My Event Centers)
 * Includes listings where user is the owner or a co-organiser.
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

    // 1️⃣ Fetch Organiser's Events (Created or Co-organised, but NOT where user is staff)
    const events = await Event.find({
      $or: [{ createdBy: userId }, { coOrganisers: userId }],
      staff: { $ne: userId },
    })
      .select({
        title: 1,
        images: 1,
        status: 1,
        eventType: 1,
        location: 1,
        createdAt: 1,
        createdBy: 1,
        coOrganisers: 1,
        staff: 1,
        performance: 1,
      })
      .sort({ createdAt: -1 });

    const formattedEvents = events
      .filter((event) => {
        const isOwner = event.createdBy?.toString() === userId;
        const isCoOrganiser = event.coOrganisers?.some(
          (id) => id.toString() === userId
        );
        return isOwner || isCoOrganiser;
      })
      .map((event) => {
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
          isCoOrganiser: obj.createdBy?.toString() !== userId,
          coOrganisers: obj.coOrganisers || [],
          staff: obj.staff || [],
          performance: obj.performance || {},
        };
      });

    // 2️⃣ Fetch Organiser's Event Centers (Created or Co-organised, but NOT where user is staff)
    const eventCenters = await EventCenter.find({
      $or: [{ createdBy: userId }, { coOrganisers: userId }],
      staff: { $ne: userId },
    })
      .select({
        venueName: 1,
        images: 1,
        status: 1,
        venueType: 1,
        location: 1,
        createdAt: 1,
        createdBy: 1,
        coOrganisers: 1,
        staff: 1,
        performance: 1,
      })
      .sort({ createdAt: -1 });

    const formattedEventCenters = eventCenters
      .filter((center) => {
        const isOwner = center.createdBy?.toString() === userId;
        const isCoOrganiser = center.coOrganisers?.some(
          (id) => id.toString() === userId
        );
        return isOwner || isCoOrganiser;
      })
      .map((center) => {
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
          isCoOrganiser: obj.createdBy?.toString() !== userId,
          coOrganisers: obj.coOrganisers || [],
          staff: obj.staff || [],
          performance: obj.performance || {},
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
