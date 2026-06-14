const mongoose = require("mongoose");
const User = require("../../models/user/user.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const EventBooking = require("../../models/user/eventBooking.schema");
const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const Ticket = require("../../models/user/eventTicket.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
const AdminAuditLog = require("../../models/admin/adminAuditLog.schema");

const getAdminOverview = async (req, res) => {
  try {
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
      pendingCoHostInvites,
      recentUsers,
      recentEvents,
      recentEventCenters,
      recentAuditLogs,
      eventRevenue,
      venueRevenue,
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
      EventCenterTicket.countDocuments(),
      UserEventTicket.countDocuments(),
      Ticket.countDocuments(),
      StaffInvitation.countDocuments({ status: "PENDING" }),
      CoHostInvitation.countDocuments({ status: "PENDING" }),
      User.find().select("firstName surname email roles isActive createdAt").sort({ createdAt: -1 }).limit(5).lean(),
      Event.find().select("title status createdAt createdBy").populate("createdBy", "firstName surname email").sort({ createdAt: -1 }).limit(5).lean(),
      EventCenter.find().select("venueName status createdAt createdBy").populate("createdBy", "firstName surname email").sort({ createdAt: -1 }).limit(5).lean(),
      AdminAuditLog.find().populate("admin", "firstName surname email").sort({ createdAt: -1 }).limit(8).lean(),
      EventBooking.aggregate([
        { $match: { paymentStatus: "COMPLETED" } },
        { $group: { _id: "$currency", total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
      ]),
      EventCenterTicket.aggregate([
        { $match: { paymentStatus: "COMPLETED" } },
        { $group: { _id: "$totalPrice.currency", total: { $sum: "$totalPrice.amount" }, count: { $sum: 1 } } },
      ]),
    ]);

    const actionRequiredListings = actionRequiredEvents + actionRequiredEventCenters;
    const pendingInvites = pendingStaffInvites + pendingCoHostInvites;

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
