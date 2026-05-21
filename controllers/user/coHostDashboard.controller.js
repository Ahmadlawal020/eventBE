const User = require("../../models/user/user.schema");
const CoHostInvitation = require("../../models/user/coHostInvitation.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const mongoose = require("mongoose");

/**
 * 📊 Get Aggregated Co-Host Statistics for Organiser Dashboard
 */
exports.getOrganiserCoHostStats = async (req, res) => {
  try {
    const organiserId = req.user.id;

    // 1. Get all co-hosts associated with organiser's listings
    const [events, centers] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("coHosts title"),
      EventCenter.find({ createdBy: organiserId }).select("coHosts venueName"),
    ]);

    const coHostMap = new Map(); // Store coHostId -> count of shared listings
    let sharedListingsCount = 0;

    events.forEach(e => {
      if (e.coHosts && e.coHosts.length > 0) {
        sharedListingsCount++;
        e.coHosts.forEach(id => {
          const strId = id.toString();
          coHostMap.set(strId, (coHostMap.get(strId) || 0) + 1);
        });
      }
    });

    centers.forEach(c => {
      if (c.coHosts && c.coHosts.length > 0) {
        sharedListingsCount++;
        c.coHosts.forEach(id => {
          const strId = id.toString();
          coHostMap.set(strId, (coHostMap.get(strId) || 0) + 1);
        });
      }
    });

    const activeCoHostsCount = coHostMap.size;

    // 2. Get pending invitations
    const pendingInvites = await CoHostInvitation.countDocuments({
      host: organiserId,
      status: "PENDING"
    });

    res.json({
      success: true,
      data: {
        activeCoHosts: activeCoHostsCount,
        sharedListings: sharedListingsCount,
        pendingInvitations: pendingInvites,
      }
    });
  } catch (error) {
    console.error("[GET ORGANISER CO-HOST STATS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 👥 Get All Co-Hosts
 */
exports.getAllCoHosts = async (req, res) => {
  try {
    const organiserId = req.user.id;

    // 1. Get all unique co-hosts
    const [events, centers] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("coHosts"),
      EventCenter.find({ createdBy: organiserId }).select("coHosts"),
    ]);

    const coHostMap = new Map(); // coHostId -> shared events count
    
    const countCoHosts = (listings) => {
      listings.forEach(listing => {
        if (listing.coHosts) {
          listing.coHosts.forEach(id => {
            const strId = id.toString();
            coHostMap.set(strId, (coHostMap.get(strId) || 0) + 1);
          });
        }
      });
    };

    countCoHosts(events);
    countCoHosts(centers);

    const coHostIds = Array.from(coHostMap.keys());

    const coHosts = await User.find({ _id: { $in: coHostIds } })
      .select("firstName surname email profilePicture isActive createdAt");

    // Map the shared listings count to each co-host
    const data = coHosts.map(user => ({
      ...user.toObject(),
      sharedListingsCount: coHostMap.get(user._id.toString())
    }));

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[GET ALL CO-HOSTS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 👤 Get Detailed Co-Host Profile
 */
exports.getCoHostDetailedProfile = async (req, res) => {
  try {
    const { coHostId } = req.params;
    const organiserId = req.user.id;

    const coHostUser = await User.findById(coHostId).select("firstName surname email profilePicture isActive createdAt");
    if (!coHostUser) {
      return res.status(404).json({ success: false, message: "Co-host not found" });
    }

    // Find all accepted invitations to see which listings and permissions they have
    const invitations = await CoHostInvitation.find({
      host: organiserId,
      coHost: coHostId,
      status: "ACCEPTED"
    }).populate("listings.listingId", "title venueName images type");

    res.json({
      success: true,
      data: {
        profile: coHostUser,
        invitations
      }
    });
  } catch (error) {
    console.error("[GET CO-HOST DETAILED PROFILE] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
