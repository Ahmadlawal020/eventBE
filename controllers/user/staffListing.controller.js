const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");

/**
 * 🔍 Get Staff Assigned Listing Details
 * Returns the full listing details for a specific listing the staff member is assigned to.
 */
const getStaffListing = async (req, res) => {
  const { listingId, listingType } = req.params;
  const staffId = req.user.id;

  try {
    // Verify the staff member has an accepted invitation for this listing
    const staffInvite = await StaffInvitation.findOne({
      staff: staffId,
      "listings.listingId": listingId,
      status: "ACCEPTED",
    });

    if (!staffInvite) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this listing.",
      });
    }

    let listing;

    if (listingType === "event") {
      listing = await Event.findById(listingId)
        .select("title images status eventType location capacity schedule shortDescription description performance createdBy entry")
        .populate("createdBy", "firstName surname email profilePicture");
    } else if (listingType === "event-center") {
      listing = await EventCenter.findById(listingId)
        .select("venueName venueType images status location capacity shortDescription description performance basePrice availability createdBy")
        .populate("createdBy", "firstName surname email profilePicture");
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid listing type. Must be 'event' or 'event-center'.",
      });
    }

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: "Listing not found.",
      });
    }

    // Get the permissions for this specific listing
    const listingEntry = staffInvite.listings.find(
      (l) => l.listingId.toString() === listingId
    );

    res.json({
      success: true,
      data: {
        listing,
        listingType,
        permissions: staffInvite.permissions,
        assignedListingType: listingEntry?.listingType,
      },
    });
  } catch (error) {
    console.error("[GET STAFF LISTING] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📊 Get Staff Listing Stats
 * Returns a lightweight stats summary for the assigned listing.
 */
const getStaffListingStats = async (req, res) => {
  const { listingId, listingType } = req.params;
  const staffId = req.user.id;

  try {
    // Verify access
    const staffInvite = await StaffInvitation.findOne({
      staff: staffId,
      "listings.listingId": listingId,
      status: "ACCEPTED",
    });

    if (!staffInvite) {
      return res.status(403).json({
        success: false,
        message: "You are not assigned to this listing.",
      });
    }

    let listing;

    if (listingType === "event") {
      listing = await Event.findById(listingId).select(
        "title images status eventType location performance"
      );
    } else if (listingType === "event-center") {
      listing = await EventCenter.findById(listingId).select(
        "venueName venueType images status location performance"
      );
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid listing type.",
      });
    }

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: "Listing not found.",
      });
    }

    const title =
      listingType === "event" ? listing.title : listing.venueName;
    const subtitle =
      listingType === "event"
        ? listing.eventTypeLabel || listing.eventType
        : listing.venueType;
    const image = listing.images?.[0]?.url || null;

    res.json({
      success: true,
      data: {
        listing: {
          id: listing._id,
          type: listingType,
          title,
          subtitle,
          image,
          status: listing.status,
          location: listing.location?.city || listing.location?.area || "",
        },
        performance: listing.performance || {},
        permissions: staffInvite.permissions,
      },
    });
  } catch (error) {
    console.error("[GET STAFF LISTING STATS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getStaffListing,
  getStaffListingStats,
};
