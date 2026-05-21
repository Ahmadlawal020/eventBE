const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const CoHostInvitation = require("../../models/user/coHostInvitation.schema");

/**
 * 📋 Get Aggregated Organiser Listings (My Events and My Event Centers)
 * Co-hosts will only see listings they have MANAGE_LISTING or ALL_ACCESS permission for.
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

    // Fetch accepted co-host invitations for this user to check permissions
    const coHostInvites = await CoHostInvitation.find({
      coHost: userId,
      status: "ACCEPTED",
    }).lean();

    // Build a map: listingId -> permissions[]
    const permissionsMap = {};
    coHostInvites.forEach((invite) => {
      if (invite.listings) {
        invite.listings.forEach((item) => {
          if (item.listingId) {
            permissionsMap[item.listingId.toString()] = invite.permissions || [];
          }
        });
      }
    });

    // Helper: check if user has MANAGE_LISTING access for a co-hosted listing
    const hasManageListingPerm = (listingId) => {
      const perms = permissionsMap[listingId.toString()] || [];
      return perms.includes("MANAGE_LISTING") || perms.includes("ALL_ACCESS");
    };

    // 1️⃣ Fetch Organiser's Events (Created or Co-hosted)
    const events = await Event.find({
      $or: [{ createdBy: userId }, { coHosts: userId }],
    })
      .select({
        title: 1,
        images: 1,
        status: 1,
        eventType: 1,
        location: 1,
        createdAt: 1,
        createdBy: 1,
        coHosts: 1,
        staff: 1,
        performance: 1,
      })
      .sort({ createdAt: -1 });

    const formattedEvents = events
      .filter((event) => {
        const isOwner = event.createdBy?.toString() === userId;
        // Owner always sees their own listings; co-hosts need MANAGE_LISTING
        return isOwner || hasManageListingPerm(event._id);
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
          isCoHost: obj.createdBy?.toString() !== userId,
          coHosts: obj.coHosts || [],
          staff: obj.staff || [],
          performance: obj.performance || {},
        };
      });

    // 2️⃣ Fetch Organiser's Event Centers (Created or Co-hosted)
    const eventCenters = await EventCenter.find({
      $or: [{ createdBy: userId }, { coHosts: userId }],
    })
      .select({
        venueName: 1,
        images: 1,
        status: 1,
        venueType: 1,
        location: 1,
        createdAt: 1,
        createdBy: 1,
        coHosts: 1,
        staff: 1,
        performance: 1,
      })
      .sort({ createdAt: -1 });

    const formattedEventCenters = eventCenters
      .filter((center) => {
        const isOwner = center.createdBy?.toString() === userId;
        return isOwner || hasManageListingPerm(center._id);
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
          isCoHost: obj.createdBy?.toString() !== userId,
          coHosts: obj.coHosts || [],
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
