const User = require("../../models/user/user.schema");
const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const mongoose = require("mongoose");

/**
 * Get Aggregated Co-Organiser Statistics for Organiser Dashboard
 */
exports.getOrganiserCoOrganiserStats = async (req, res) => {
  try {
    const organiserId = req.user.id;

    // 1. Get all co-organisers associated with organiser's listings
    const [events, centers] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("coOrganisers title"),
      EventCenter.find({ createdBy: organiserId }).select("coOrganisers venueName"),
    ]);

    const coOrganiserMap = new Map(); // Store coOrganiserId -> count of shared listings
    let sharedListingsCount = 0;

    events.forEach(e => {
      if (e.coOrganisers && e.coOrganisers.length > 0) {
        sharedListingsCount++;
        e.coOrganisers.forEach(id => {
          const strId = id.toString();
          coOrganiserMap.set(strId, (coOrganiserMap.get(strId) || 0) + 1);
        });
      }
    });

    centers.forEach(c => {
      if (c.coOrganisers && c.coOrganisers.length > 0) {
        sharedListingsCount++;
        c.coOrganisers.forEach(id => {
          const strId = id.toString();
          coOrganiserMap.set(strId, (coOrganiserMap.get(strId) || 0) + 1);
        });
      }
    });

    const activeCoOrganisersCount = coOrganiserMap.size;

    // 2. Get pending invitations
    const pendingInvites = await CoOrganiserInvitation.countDocuments({
      host: organiserId,
      status: "PENDING"
    });

    res.json({
      success: true,
      data: {
        activeCoOrganisers: activeCoOrganisersCount,
        sharedListings: sharedListingsCount,
        pendingInvitations: pendingInvites,
      }
    });
  } catch (error) {
    console.error("[GET ORGANISER CO-ORGANISER STATS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Get All Co-Organisers
 */
exports.getAllCoOrganisers = async (req, res) => {
  try {
    const organiserId = req.user.id;

    // 1. Get all unique co-organisers
    const [events, centers] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("coOrganisers"),
      EventCenter.find({ createdBy: organiserId }).select("coOrganisers"),
    ]);

    const coOrganiserMap = new Map(); // coOrganiserId -> shared events count
    
    const countCoOrganisers = (listings) => {
      listings.forEach(listing => {
        if (listing.coOrganisers) {
          listing.coOrganisers.forEach(id => {
            const strId = id.toString();
            coOrganiserMap.set(strId, (coOrganiserMap.get(strId) || 0) + 1);
          });
        }
      });
    };

    countCoOrganisers(events);
    countCoOrganisers(centers);

    const coOrganiserIds = Array.from(coOrganiserMap.keys());

    const coOrganisers = await User.find({ _id: { $in: coOrganiserIds } })
      .select("firstName surname email profilePicture isActive createdAt");

    // Map the shared listings count to each co-organiser
    const data = coOrganisers.map(user => ({
      ...user.toObject(),
      sharedListingsCount: coOrganiserMap.get(user._id.toString())
    }));

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[GET ALL CO-ORGANISERS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * Get Detailed Co-Organiser Profile
 */
exports.getCoOrganiserDetailedProfile = async (req, res) => {
  try {
    const { coOrganiserId } = req.params;
    const organiserId = req.user.id;

    const coOrganiserUser = await User.findById(coOrganiserId).select("firstName surname email profilePicture isActive createdAt");
    if (!coOrganiserUser) {
      return res.status(404).json({ success: false, message: "Co-organiser not found" });
    }

    // Find all accepted invitations to see which listings and permissions they have
    const invitations = await CoOrganiserInvitation.find({
      host: organiserId,
      coOrganiser: coOrganiserId,
      status: "ACCEPTED"
    }).populate("listings.listingId", "title venueName images type");

    res.json({
      success: true,
      data: {
        profile: coOrganiserUser,
        invitations
      }
    });
  } catch (error) {
    console.error("[GET CO-ORGANISER DETAILED PROFILE] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
