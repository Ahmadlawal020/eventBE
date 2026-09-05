const mongoose = require("mongoose");
const User = require("../../models/client/user.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const Ticket = require("../../models/client/eventTicketType.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const StaffInvitation = require("../../models/client/staffInvitation.schema");
const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
const AdminAuditLog = require("../../models/management/adminAuditLog.schema");

const getAdminOverview = async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const [
      totalUsers,
      activeUsers,
      organisers,
      staffUsers,
      events,
      eventCenters,
      listedEvents,
      listedEventCenters,
      actionRequiredEvents,
      actionRequiredEventCenters,
      eventBookings,
      venueBookings,
      soldEventTickets,
      ticketTypes,
      pendingStaffInvites,
      pendingCoOrganiserInvites,
      recentUsers,
      recentEvents,
      recentEventCenters,
      recentAuditLogs,
      eventRevenue,
      venueRevenue,
      // Deltas: this period vs previous period (last 30 days vs 30-60 days ago)
      newUsersThisPeriod,
      newUsersLastPeriod,
      newEventsThisPeriod,
      newEventsLastPeriod,
      newBookingsThisPeriod,
      newBookingsLastPeriod,
      newVenueBookingsThisPeriod,
      newVenueBookingsLastPeriod,
      // Revenue trend: daily revenue for last 30 days
      dailyEventRevenue,
      dailyVenueRevenue,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ roles: "organiser" }),
      User.countDocuments({ roles: "staff" }),
      Event.countDocuments(),
      EventCenter.countDocuments(),
      Event.countDocuments({ status: "LISTED" }),
      EventCenter.countDocuments({ status: "LISTED" }),
      Event.countDocuments({ status: "ACTION_REQUIRED" }),
      EventCenter.countDocuments({ status: "ACTION_REQUIRED" }),
      EventBooking.countDocuments(),
      EventCenterBooking.countDocuments(),
      UserEventTicket.countDocuments(),
      Ticket.countDocuments(),
      StaffInvitation.countDocuments({ status: "PENDING" }),
      CoOrganiserInvitation.countDocuments({ status: "PENDING" }),
      User.find().select("firstName surname email roles isActive createdAt").sort({ createdAt: -1 }).limit(5).lean(),
      Event.find().select("title status createdAt createdBy").populate("createdBy", "firstName surname email").sort({ createdAt: -1 }).limit(5).lean(),
      EventCenter.find().select("venueName status createdAt createdBy").populate("createdBy", "firstName surname email").sort({ createdAt: -1 }).limit(5).lean(),
      AdminAuditLog.find().populate("admin", "firstName surname email").sort({ createdAt: -1 }).limit(8).lean(),
      EventBooking.aggregate([
        { $match: { paymentStatus: "COMPLETED" } },
        { $group: { _id: "$currency", total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
      ]),
      EventCenterBooking.aggregate([
        { $match: { paymentStatus: "COMPLETED" } },
        { $group: { _id: "$totalPrice.currency", total: { $sum: "$totalPrice.amount" }, count: { $sum: 1 } } },
      ]),
      // Delta queries
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      Event.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Event.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      EventBooking.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      EventBooking.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      EventCenterBooking.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      EventCenterBooking.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      // Revenue trend (daily, last 30 days)
      EventBooking.aggregate([
        { $match: { paymentStatus: "COMPLETED", createdAt: { $gte: thirtyDaysAgo } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
      EventCenterBooking.aggregate([
        { $match: { paymentStatus: "COMPLETED", createdAt: { $gte: thirtyDaysAgo } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: "$totalPrice.amount" },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);

    const actionRequiredListings = actionRequiredEvents + actionRequiredEventCenters;
    const pendingInvites = pendingStaffInvites + pendingCoOrganiserInvites;

    // Calculate deltas
    const calcDelta = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // Merge daily revenue into a single trend
    const trendMap = {};
    for (const entry of dailyEventRevenue) {
      trendMap[entry._id] = { date: entry._id, eventRevenue: entry.total, eventCount: entry.count, venueRevenue: 0, venueCount: 0 };
    }
    for (const entry of dailyVenueRevenue) {
      if (!trendMap[entry._id]) {
        trendMap[entry._id] = { date: entry._id, eventRevenue: 0, eventCount: 0, venueRevenue: entry.total, venueCount: entry.count };
      } else {
        trendMap[entry._id].venueRevenue = entry.total;
        trendMap[entry._id].venueCount = entry.count;
      }
    }
    const revenueTrend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalUsers,
          activeUsers,
          organisers,
          staffUsers,
          events,
          eventCenters,
          listedListings: listedEvents + listedEventCenters,
          actionRequiredListings,
          eventBookings,
          venueBookings,
          soldEventTickets,
          ticketTypes,
          pendingInvites,
        },
        deltas: {
          users: { current: newUsersThisPeriod, previous: newUsersLastPeriod, delta: calcDelta(newUsersThisPeriod, newUsersLastPeriod) },
          events: { current: newEventsThisPeriod, previous: newEventsLastPeriod, delta: calcDelta(newEventsThisPeriod, newEventsLastPeriod) },
          eventBookings: { current: newBookingsThisPeriod, previous: newBookingsLastPeriod, delta: calcDelta(newBookingsThisPeriod, newBookingsLastPeriod) },
          venueBookings: { current: newVenueBookingsThisPeriod, previous: newVenueBookingsLastPeriod, delta: calcDelta(newVenueBookingsThisPeriod, newVenueBookingsLastPeriod) },
        },
        revenueTrend,
        revenue: {
          eventRevenue,
          venueRevenue,
        },
        recent: {
          users: recentUsers,
          events: recentEvents,
          eventCenters: recentEventCenters,
          auditLogs: recentAuditLogs,
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN OVERVIEW ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching admin overview" });
  }
};

const getAdminAnalytics = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [usersByRole, listingsByStatus, bookingsByPaymentStatus, topEvents, topVenues] = await Promise.all([
      User.aggregate([
        { $unwind: "$roles" },
        { $group: { _id: "$roles", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Promise.all([
        Event.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        EventCenter.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      ]),
      EventBooking.aggregate([{ $group: { _id: "$paymentStatus", count: { $sum: 1 } } }]),
      Event.find({ createdAt: { $gte: thirtyDaysAgo } })
        .select("title status performance createdAt")
        .sort({ "performance.views": -1 })
        .limit(8)
        .lean(),
      EventCenter.find({ createdAt: { $gte: thirtyDaysAgo } })
        .select("venueName status performance createdAt")
        .sort({ "performance.bookings": -1 })
        .limit(8)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        usersByRole,
        listingsByStatus: {
          events: listingsByStatus[0],
          eventCenters: listingsByStatus[1],
        },
        bookingsByPaymentStatus,
        topEvents,
        topVenues,
      },
    });
  } catch (error) {
    console.error("[ADMIN ANALYTICS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching admin analytics" });
  }
};

module.exports = {
  getAdminOverview,
  getAdminAnalytics,
};
