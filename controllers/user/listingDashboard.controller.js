const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const mongoose = require("mongoose");

/**
 * @desc    Get aggregate listing statistics for an organiser across all their events and venues
 * @route   GET /api/organiser/listing-stats
 * @access  Private (Organiser only)
 */
const getOrganiserListingStats = async (req, res) => {
  const organiserId = req.user.id;

  try {
    // 1. Fetch Organiser's Events (Created or Co-hosted, NOT where user is staff)
    const events = await Event.find({
      $or: [
        { createdBy: organiserId },
        { coHosts: organiserId },
      ],
      staff: { $ne: organiserId },
    }).select("performance status").lean();

    // 2. Fetch Organiser's Event Centers (Created or Co-hosted, NOT where user is staff)
    const eventCenters = await EventCenter.find({
      $or: [
        { createdBy: organiserId },
        { coHosts: organiserId },
      ],
      staff: { $ne: organiserId },
    }).select("performance status").lean();

    const allListings = [...events, ...eventCenters];

    if (allListings.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          aggregate: {
            totalListings: 0,
            activeListings: 0,
            totalViews: 0,
            totalWishlists: 0,
            totalReach: 0,
            totalEngagement: 0,
            totalMessages: 0,
            totalShares: 0,
          },
        },
      });
    }

    // 3. Aggregate Performance
    let totalViews = 0;
    let totalWishlists = 0;
    let totalReach = 0;
    let totalEngagement = 0;
    let totalMessages = 0;
    let totalShares = 0;
    let activeListings = 0;

    allListings.forEach((l) => {
      if (l.status === "LISTED") activeListings++;
      const p = l.performance || {};
      totalViews += p.views || 0;
      totalWishlists += p.wishlists || 0;
      totalReach += p.reach || 0;
      totalEngagement += p.engagement || 0;
      totalMessages += p.messages || 0;
      totalShares += p.shares || 0;
    });

    res.status(200).json({
      success: true,
      data: {
        aggregate: {
          totalListings: allListings.length,
          activeListings,
          totalViews,
          totalWishlists,
          totalReach,
          totalEngagement,
          totalMessages,
          totalShares,
        },
      },
    });
  } catch (error) {
    console.error("[GET ORGANISER LISTING STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching listing statistics" });
  }
};

/**
 * @desc    Get detailed performance statistics for a single listing (Event or Event Center)
 * @route   GET /api/organiser/listing-stats/:id
 * @access  Private (Organiser/Co-host/Staff)
 */
const getSingleListingStats = async (req, res) => {
  const { id } = req.params;
  const { type } = req.query; // 'event' or 'event-center'
  const organiserId = req.user.id;

  try {
    let listing;

    if (type === "event") {
      listing = await Event.findOne({
        _id: id,
        $or: [
          { createdBy: organiserId },
          { coHosts: organiserId },
          { staff: organiserId },
        ],
      }).select("title images status performance performers eventType schedule location").lean();
    } else {
      listing = await EventCenter.findOne({
        _id: id,
        $or: [
          { createdBy: organiserId },
          { coHosts: organiserId },
          { staff: organiserId },
        ],
      }).select("venueName images status performance venueType location").lean();
    }

    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found or access denied" });
    }

    // Since we don't have historical performance data in the schema yet (it's just a single object),
    // we return the current performance metrics. 
    // In a real app, you'd probably have a Performance collection tracking this daily.
    // For now, we'll provide the current stats and some simulated trend data if needed.

    const performance = listing.performance || {
      views: 0,
      clicks: 0,
      wishlists: 0,
      reach: 0,
      engagement: 0,
      messages: 0,
      shares: 0,
    };

    // Calculate a simple performance score
    const views = performance.views || 1;
    const engagementScore = ((performance.engagement || 0) / views) * 100;
    const performanceScore = Math.min(100, Math.round(engagementScore * 2 + 30));

    res.status(200).json({
      success: true,
      data: {
        listing: {
          id: listing._id,
          title: listing.title || listing.venueName,
          type: type,
          status: listing.status,
          image: listing.images?.[0]?.url || "",
          subtitle: type === 'event' ? listing.eventType : listing.venueType,
          location: listing.location?.city,
          performers: listing.performers || [],
        },
        stats: {
          ...performance,
          performanceScore,
          conversionRate: ((performance.clicks || 0) / (performance.views || 1) * 100).toFixed(1),
        },
        // In a real implementation, you'd aggregate historical data here
        // For this task, we'll stick to the current performance object
      },
    });
  } catch (error) {
    console.error("[GET SINGLE LISTING STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching listing performance" });
  }
};

module.exports = {
  getOrganiserListingStats,
  getSingleListingStats,
};
