const EventCenter = require("../../models/user/eventCenter.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const mongoose = require("mongoose");
const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");

/**
 * @desc    Get aggregate booking statistics for an organiser across all their event centers
 * @route   GET /api/organiser/booking-stats
 * @access  Private (Organiser only)
 */
const getOrganiserBookingStats = async (req, res) => {
  const organiserId = req.user.id;

  try {
    // 1. Find all event centers managed by this organiser (Created or Co-hosted, NOT where user is staff)
    const venuesRaw = await EventCenter.find({
      $or: [
        { createdBy: organiserId },
        { coHosts: organiserId },
      ],
      staff: { $ne: organiserId },
    })
      .select("_id venueName status location images venueType performance createdBy")
      .sort({ createdAt: -1 })
      .lean();

    // Fetch accepted invitations for co-host and staff to check permissions
    const [coHostInvites, staffInvites] = await Promise.all([
      CoHostInvitation.find({ coHost: organiserId, status: "ACCEPTED" }).lean(),
      StaffInvitation.find({ staff: organiserId, status: "ACCEPTED" }).lean(),
    ]);

    const permissionsMap = {};
    coHostInvites.forEach(invite => {
      if (invite.listings) {
        invite.listings.forEach(item => {
          if (item.listingType === "EventCenter" && item.listingId) {
            permissionsMap[item.listingId.toString()] = invite.permissions || [];
          }
        });
      }
    });
    staffInvites.forEach(invite => {
      if (invite.listings) {
        invite.listings.forEach(item => {
          if (item.listingType === "EventCenter" && item.listingId) {
            permissionsMap[item.listingId.toString()] = invite.permissions || [];
          }
        });
      }
    });

    const venues = venuesRaw.map(venue => {
      const isOwner = venue.createdBy && venue.createdBy.toString() === organiserId.toString();
      const userPerms = permissionsMap[venue._id.toString()] || [];
      const hasFinancePerm = isOwner || userPerms.includes("VIEW_FINANCES") || userPerms.includes("ALL_ACCESS");

      return {
        ...venue,
        hasFinancePerm
      };
    });

    const venueIds = venues.map((v) => v._id);
    const financeVenueIds = venues.filter(v => v.hasFinancePerm).map(v => v._id);

    if (venueIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          aggregate: {
            totalBookings: 0, activeBookings: 0, completedBookings: 0, cancelledBookings: 0,
            totalCheckedIn: 0, qrCheckIn: 0, manualCheckIn: 0,
            totalRevenue: 0, pendingRevenue: 0, pendingPayments: 0,
            avgBookingValue: 0,
            revenueByCurrency: [],
            revenueByBookingUnit: [],
            staffEfficiency: [],
            venueAnalytics: { listed: 0, inProgress: 0, actionRequired: 0, unlisted: 0, byType: {}, byCity: {} },
            platformEngagement: { totalViews: 0, totalClicks: 0, totalWishlists: 0, totalReach: 0, totalMessages: 0, totalPendingInquiries: 0 },
            hasGlobalFinancePerm: false
          },
          venues: [],
        },
      });
    }

    // 2. Aggregate Booking Data
    const bookingStats = await EventCenterBooking.aggregate([
      { $match: { eventCenter: { $in: venueIds } } },
      {
        $facet: {
          globalStats: [
            {
              $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                activeBookings: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } },
                completedBookings: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
                cancelledBookings: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
                totalCheckedIn: { $sum: { $cond: ["$checkIn.isCheckedIn", 1, 0] } },
                qrCheckIn: { $sum: { $cond: [{ $eq: ["$checkIn.method", "QR"] }, 1, 0] } },
                manualCheckIn: { $sum: { $cond: [{ $eq: ["$checkIn.method", "MANUAL"] }, 1, 0] } },
                totalRevenue: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$paymentStatus", "COMPLETED"] }, { $in: ["$eventCenter", financeVenueIds] }] },
                      "$totalPrice.amount",
                      0
                    ]
                  },
                },
                pendingRevenue: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$paymentStatus", "PENDING"] }, { $in: ["$eventCenter", financeVenueIds] }] },
                      "$totalPrice.amount",
                      0
                    ]
                  },
                },
                pendingPayments: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$paymentStatus", "PENDING"] }, { $in: ["$eventCenter", financeVenueIds] }] },
                      1,
                      0
                    ]
                  }
                },
              },
            },
          ],
          revenueByCurrency: [
            { $match: { eventCenter: { $in: financeVenueIds }, paymentStatus: "COMPLETED" } },
            {
              $group: { _id: "$totalPrice.currency", revenue: { $sum: "$totalPrice.amount" } }
            }
          ],
          revenueByBookingUnit: [
            { $match: { eventCenter: { $in: financeVenueIds }, paymentStatus: "COMPLETED" } },
            {
              $group: { _id: "$bookingUnit", revenue: { $sum: "$totalPrice.amount" } }
            }
          ],
          staffEfficiency: [
            { $match: { "checkIn.isCheckedIn": true, "checkIn.checkedInBy": { $exists: true, $ne: null } } },
            {
              $group: { _id: "$checkIn.checkedInBy", count: { $sum: 1 } }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
          ]
        }
      }
    ]);

    const facetData = bookingStats[0];
    const agg = facetData.globalStats[0] || {
      totalBookings: 0, activeBookings: 0, completedBookings: 0, cancelledBookings: 0,
      totalCheckedIn: 0, qrCheckIn: 0, manualCheckIn: 0,
      totalRevenue: 0, pendingRevenue: 0, pendingPayments: 0,
    };

    const avgBookingValue = financeVenueIds.length > 0 && agg.totalBookings > 0 ? (agg.totalRevenue / agg.totalBookings).toFixed(2) : null;

    const venueAnalytics = {
      listed: venues.filter(v => v.status === "LISTED").length,
      inProgress: venues.filter(v => v.status === "IN_PROGRESS").length,
      actionRequired: venues.filter(v => v.status === "ACTION_REQUIRED").length,
      unlisted: venues.filter(v => v.status === "UNLISTED").length,
      byType: venues.reduce((acc, v) => {
        if (v.venueType) acc[v.venueType] = (acc[v.venueType] || 0) + 1;
        return acc;
      }, {}),
      byCity: venues.reduce((acc, v) => {
        if (v.location?.city) acc[v.location.city] = (acc[v.location.city] || 0) + 1;
        return acc;
      }, {})
    };

    const platformEngagement = {
      totalViews: venues.reduce((sum, v) => sum + (v.performance?.views || 0), 0),
      totalClicks: venues.reduce((sum, v) => sum + (v.performance?.clicks || 0), 0),
      totalWishlists: venues.reduce((sum, v) => sum + (v.performance?.wishlists || 0), 0),
      totalReach: venues.reduce((sum, v) => sum + (v.performance?.reach || 0), 0),
      totalMessages: venues.reduce((sum, v) => sum + (v.performance?.messages || 0), 0),
      totalPendingInquiries: venues.reduce((sum, v) => sum + (v.performance?.pendingInquiries || 0), 0),
    };

    // 3. Format Venue List with specific stats
    const venueStats = await EventCenterBooking.aggregate([
      { $match: { eventCenter: { $in: venueIds } } },
      {
        $group: {
          _id: "$eventCenter",
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, "$totalPrice.amount", 0],
            },
          },
          checkedIn: { $sum: { $cond: ["$checkIn.isCheckedIn", 1, 0] } },
          pendingReview: { $sum: { $cond: [{ $eq: ["$status", "PENDING_REVIEW"] }, 1, 0] } },
        },
      },
    ]);

    const venueStatsMap = {};
    venueStats.forEach((s) => {
      venueStatsMap[s._id.toString()] = s;
    });

    const venueList = venues.map((v) => {
      const stats = venueStatsMap[v._id.toString()] || { count: 0, revenue: 0, checkedIn: 0, pendingReview: 0 };
      return {
        id: v._id,
        venueName: v.venueName,
        status: v.status,
        image: v.images?.[0]?.url || "",
        hasFinancePerm: v.hasFinancePerm,
        bookings: {
          total: stats.count,
          revenue: v.hasFinancePerm ? stats.revenue : null,
          checkedIn: stats.checkedIn,
          pendingReview: stats.pendingReview,
        },
      };
    });

    // 4. Fetch pending review bookings across all venues
    const pendingRequests = await EventCenterBooking.find({
      eventCenter: { $in: venueIds },
      status: "PENDING_REVIEW",
    })
      .populate("buyer", "firstName surname email profileImage")
      .populate("eventCenter", "venueName")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const pendingRequestsList = pendingRequests.map((t) => ({
      bookingId: String(t._id),
      guestName: t.guestDetails?.fullName || (t.buyer ? `${t.buyer.firstName} ${t.buyer.surname}` : ""),
      guestEmail: t.guestDetails?.email || t.buyer?.email || "",
      guestImage: t.buyer?.profileImage || null,
      venueName: t.eventCenter?.venueName || "",
      venueId: t.eventCenter?._id || t.eventCenter,
      selectedDates: t.selectedDates || [],
      bookingUnit: t.bookingUnit,
      duration: t.duration,
      totalPrice: t.totalPrice,
      reviewDeadline: t.reviewDeadline,
      createdAt: t.createdAt,
    }));

    const totalPendingReview = pendingRequestsList.length;

    res.status(200).json({
      success: true,
      data: {
        aggregate: {
          ...agg,
          totalRevenue: financeVenueIds.length > 0 ? agg.totalRevenue : null,
          pendingRevenue: financeVenueIds.length > 0 ? agg.pendingRevenue : null,
          avgBookingValue: avgBookingValue !== null ? Number(avgBookingValue) : null,
          utilizationRate: venues.length > 0 ? ((agg.activeBookings / (venues.length * 30)) * 100).toFixed(1) + "%" : "0%", // Simplified calc
          revenueByCurrency: facetData.revenueByCurrency,
          revenueByBookingUnit: facetData.revenueByBookingUnit,
          staffEfficiency: facetData.staffEfficiency,
          venueAnalytics,
          platformEngagement,
          hasGlobalFinancePerm: financeVenueIds.length > 0,
          pendingReviewCount: totalPendingReview,
          pendingRequests: pendingRequestsList,
        },
        venues: venueList,
      },
    });
  } catch (error) {
    console.error("[GET ORGANISER BOOKING STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching booking statistics" });
  }
};

/**
 * @desc    Get detailed bookings for a single event center
 * @route   GET /api/organiser/booking-stats/:venueId
 * @access  Private (Organiser/Co-host/Staff)
 */
const getSingleVenueBookingStats = async (req, res) => {
  const { venueId } = req.params;
  const organiserId = req.user.id;

  try {
    const venue = await EventCenter.findOne({
      _id: venueId,
      $or: [
        { createdBy: organiserId },
        { coHosts: organiserId },
        { staff: organiserId },
      ],
    }).select("_id venueName images status createdBy bookingSettings").lean();

    if (!venue) {
      return res.status(404).json({ success: false, message: "Venue not found or access denied" });
    }

    // Owner/creator has full access. Otherwise, verify permissions for co-host or staff.
    let hasFinancePerm = true;
    if (venue.createdBy && venue.createdBy.toString() !== organiserId.toString()) {
      const [coHostInvite, staffInvite] = await Promise.all([
        CoHostInvitation.findOne({ coHost: organiserId, status: "ACCEPTED", "listings.listingId": venueId }).lean(),
        StaffInvitation.findOne({ staff: organiserId, status: "ACCEPTED", "listings.listingId": venueId }).lean(),
      ]);

      const userPerms = (coHostInvite?.permissions || []).concat(staffInvite?.permissions || []);
      const hasCalendarPerm = userPerms.includes("VIEW_CALENDAR") || userPerms.includes("MANAGE_CALENDAR");
      const hasFinancePermCheck = userPerms.includes("VIEW_FINANCES") || userPerms.includes("ALL_ACCESS");

      if (hasCalendarPerm && !hasFinancePermCheck) {
        hasFinancePerm = false;
      }
    }

    const bookings = await EventCenterBooking.find({ eventCenter: venueId })
      .populate("buyer", "firstName surname email profileImage")
      .sort({ createdAt: -1 })
      .lean();

    const bookingsList = bookings.map(b => {
      if (!hasFinancePerm) {
        return {
          ...b,
          totalPrice: {
            ...b.totalPrice,
            amount: null
          }
        };
      }
      return b;
    });

    // Aggregate stats for this specific venue
    const stats = {
      total: bookings.length,
      active: bookings.filter(b => b.status === 'ACTIVE' || b.status === 'CONFIRMED').length,
      pendingReview: bookings.filter(b => b.status === 'PENDING_REVIEW').length,
      checkedIn: bookings.filter(b => b.checkIn.isCheckedIn).length,
      revenue: hasFinancePerm ? bookings.filter(b => b.paymentStatus === 'COMPLETED').reduce((acc, b) => acc + b.totalPrice.amount, 0) : null,
    };

    res.status(200).json({
      success: true,
      data: {
        venue,
        stats,
        bookings: bookingsList,
        hasFinancePerm
      }
    });
  } catch (error) {
    console.error("[GET SINGLE VENUE BOOKING STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching venue bookings" });
  }
};

module.exports = {
  getOrganiserBookingStats,
  getSingleVenueBookingStats,
};
