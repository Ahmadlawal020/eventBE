const User = require("../../models/client/user.schema");
const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const ReferralEarning = require("../../models/client/referralEarning.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const AdminAuditLog = require("../../models/management/adminAuditLog.schema");
const {
  recordAdminAction,
} = require("../../services/management/adminAudit.service");

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getUsers = async (req, res) => {
  try {
    const { search, role, status, page = 1, limit = 20 } = req.query;
    const query = {};
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));

    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { firstName: new RegExp(safeSearch, "i") },
        { surname: new RegExp(safeSearch, "i") },
        { email: new RegExp(safeSearch, "i") },
        { phoneNumber: new RegExp(safeSearch, "i") },
      ];
    }

    if (role) query.roles = role;
    if (status === "active") query.isActive = true;
    if (status === "suspended") query.isActive = false;

    const skip = (pageNumber - 1) * limitNumber;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const [
      users,
      total,
      allUsers,
      activeUsers,
      verifiedUsers,
      organisers,
      newUsers,
    ] = await Promise.all([
      User.find(query)
        .select("-password -refreshToken")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      User.countDocuments(query),
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isIdentityVerified: true }),
      User.countDocuments({ roles: "organiser" }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        users,
        metrics: {
          total: allUsers,
          active: activeUsers,
          suspended: allUsers - activeUsers,
          identityVerified: verifiedUsers,
          organisers,
          newLast30Days: newUsers,
        },
        pagination: {
          total,
          page: pageNumber,
          pages: Math.ceil(total / limitNumber),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET USERS ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching users" });
  }
};

const getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }
    const userObjectId = new mongoose.Types.ObjectId(id);
    const userObjectIdStr = String(id);

    // 1. Fetch user record
    const user = await User.findById(id)
      .select("-password -refreshToken")
      .populate("referredBy", "firstName surname email referralCode")
      .lean();

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // 2. Initial parallel queries: events, centers, customer bookings, referrals, tickets, and audit logs
    const [
      events,
      eventCenters,
      customerEventBookings,
      customerVenueBookings,
      referralEarnings,
      referredUsersCount,
      recentReferredUsers,
      scansPerformed,
      userTicketsOwned,
      auditLogs,
    ] = await Promise.all([
      Event.find({
        $or: [{ createdBy: userObjectId }, { coOrganisers: userObjectId }, { staff: userObjectId }],
      })
        .select("title status schedule performance createdAt coOrganisers staff createdBy location coverImage eventType category")
        .populate("coOrganisers", "firstName surname email")
        .populate("staff", "firstName surname email")
        .populate("createdBy", "firstName surname email")
        .sort({ createdAt: -1 })
        .lean(),
      EventCenter.find({
        $or: [{ createdBy: userObjectId }, { coOrganisers: userObjectId }, { staff: userObjectId }],
      })
        .select("venueName status performance createdAt coOrganisers staff createdBy address city state capacity media contact")
        .populate("coOrganisers", "firstName surname email")
        .populate("staff", "firstName surname email")
        .populate("createdBy", "firstName surname email")
        .sort({ createdAt: -1 })
        .lean(),
      EventBooking.find({ buyer: userObjectId })
        .select("eventId totalAmount subtotalAmount currency paymentStatus status items createdAt paymentMethod")
        .populate("eventId", "title schedule location")
        .sort({ createdAt: -1 })
        .limit(15)
        .lean(),
      EventCenterBooking.find({ buyer: userObjectId })
        .select("eventCenter totalPrice subtotalPrice paymentStatus status selectedDates bookingUnit duration createdAt")
        .populate("eventCenter", "venueName address city state")
        .sort({ createdAt: -1 })
        .limit(15)
        .lean(),
      ReferralEarning.find({ referrer: userObjectId })
        .populate("referredUser", "firstName surname email createdAt")
        .populate("eventId", "title")
        .populate("eventCenterId", "venueName")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      User.countDocuments({ referredBy: userObjectId }),
      User.find({ referredBy: userObjectId })
        .select("firstName surname email createdAt isActive lastLoginAt")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      UserEventTicket.find({ "checkIn.checkedInBy": userObjectId, "checkIn.isCheckedIn": true })
        .select("ticketNumber ticketName checkIn eventId owner createdAt")
        .populate("eventId", "title schedule")
        .populate("owner", "firstName surname email")
        .sort({ "checkIn.checkedInAt": -1 })
        .limit(20)
        .lean(),
      UserEventTicket.find({ owner: userObjectId })
        .select("ticketNumber ticketName status checkIn eventId ticketSnapshot createdAt")
        .populate("eventId", "title schedule location")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      AdminAuditLog.find({ targetId: userObjectId, targetType: "User" })
        .populate("admin", "firstName surname email role")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    // 3. Extract organised event and center IDs
    const organisedEventIds = events
      .filter((e) => {
        const isCreator = String(e.createdBy?._id || e.createdBy) === userObjectIdStr;
        const isCo = Array.isArray(e.coOrganisers) && e.coOrganisers.some((co) => String(co?._id || co) === userObjectIdStr);
        return isCreator || isCo;
      })
      .map((e) => e._id);

    const organisedCenterIds = eventCenters
      .filter((c) => {
        const isCreator = String(c.createdBy?._id || c.createdBy) === userObjectIdStr;
        const isCo = Array.isArray(c.coOrganisers) && c.coOrganisers.some((co) => String(co?._id || co) === userObjectIdStr);
        return isCreator || isCo;
      })
      .map((c) => c._id);

    // 4. Aggregate Ticket Sales Earnings & Orders
    const ticketSalesStats = {
      grossRevenue: 0,
      netPayout: 0,
      platformFees: 0,
      completedOrdersCount: 0,
      pendingOrdersCount: 0,
      totalTicketsSold: 0,
      recentOrders: [],
    };

    if (organisedEventIds.length > 0) {
      const [completedTicketBookings, pendingTicketBookings, recentOrders] = await Promise.all([
        EventBooking.find({
          eventId: { $in: organisedEventIds },
          paymentStatus: "COMPLETED",
        }).select("totalAmount subtotalAmount organiserPayoutAmount platformFeeAmount items").lean(),
        EventBooking.find({
          eventId: { $in: organisedEventIds },
          paymentStatus: "PENDING",
        }).select("totalAmount subtotalAmount organiserPayoutAmount").lean(),
        EventBooking.find({
          eventId: { $in: organisedEventIds },
        })
          .select("eventId buyer guestDetails totalAmount paymentStatus status items createdAt currency")
          .populate("eventId", "title")
          .populate("buyer", "firstName surname email phoneNumber")
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
      ]);

      completedTicketBookings.forEach((b) => {
        ticketSalesStats.grossRevenue += (b.totalAmount || 0) / 100;
        ticketSalesStats.netPayout += (b.organiserPayoutAmount ?? b.subtotalAmount ?? b.totalAmount ?? 0) / 100;
        ticketSalesStats.platformFees += (b.platformFeeAmount || 0) / 100;
        ticketSalesStats.completedOrdersCount += 1;
        if (Array.isArray(b.items)) {
          b.items.forEach((item) => {
            ticketSalesStats.totalTicketsSold += (Number(item.quantity) || 0);
          });
        } else {
          ticketSalesStats.totalTicketsSold += 1;
        }
      });

      ticketSalesStats.pendingOrdersCount = pendingTicketBookings.length;
      ticketSalesStats.recentOrders = recentOrders.map((o) => ({
        _id: o._id,
        eventId: o.eventId,
        buyer: o.buyer || o.guestDetails,
        quantity: Array.isArray(o.items)
          ? o.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
          : 1,
        totalAmount: (o.totalAmount || 0) / 100,
        currency: o.currency || "NGN",
        paymentStatus: o.paymentStatus,
        status: o.status,
        createdAt: o.createdAt,
      }));
    }

    // 5. Aggregate Event Center Booking Earnings & Orders
    const venueBookingsStats = {
      grossRevenue: 0,
      netPayout: 0,
      platformFees: 0,
      completedBookingsCount: 0,
      pendingBookingsCount: 0,
      recentBookings: [],
    };

    const venueQuery = {
      $or: [
        { organiser: userObjectId },
        ...(organisedCenterIds.length ? [{ eventCenter: { $in: organisedCenterIds } }] : []),
      ],
    };

    const [completedVenueBookings, pendingVenueBookings, recentVenueBookings] = await Promise.all([
      EventCenterBooking.find({
        ...venueQuery,
        paymentStatus: "COMPLETED",
      }).select("totalPrice subtotalPrice organiserPayoutAmount platformFeeAmount").lean(),
      EventCenterBooking.find({
        ...venueQuery,
        paymentStatus: "PENDING",
      }).select("totalPrice subtotalPrice organiserPayoutAmount").lean(),
      EventCenterBooking.find(venueQuery)
        .select("eventCenter buyer guestDetails totalPrice paymentStatus status selectedDates bookingUnit duration createdAt")
        .populate("eventCenter", "venueName address city state")
        .populate("buyer", "firstName surname email phoneNumber")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    completedVenueBookings.forEach((b) => {
      venueBookingsStats.grossRevenue += (b.totalPrice?.amount ?? 0);
      venueBookingsStats.netPayout += (b.organiserPayoutAmount ?? b.subtotalPrice?.amount ?? b.totalPrice?.amount ?? 0);
      venueBookingsStats.platformFees += (b.platformFeeAmount ?? 0);
      venueBookingsStats.completedBookingsCount += 1;
    });

    venueBookingsStats.pendingBookingsCount = pendingVenueBookings.length;
    venueBookingsStats.recentBookings = recentVenueBookings.map((b) => ({
      _id: b._id,
      eventCenter: b.eventCenter,
      buyer: b.buyer || b.guestDetails,
      amount: b.totalPrice?.amount ?? 0,
      currency: b.totalPrice?.currency || "NGN",
      paymentStatus: b.paymentStatus,
      status: b.status,
      bookingUnit: b.bookingUnit,
      duration: b.duration,
      selectedDates: b.selectedDates,
      createdAt: b.createdAt,
    }));

    // 6. Aggregate Affiliation / Referral Program
    const affiliationStats = {
      referralCode: user.referralCode || "",
      totalEarnings: 0,
      pendingEarnings: 0,
      refundedEarnings: 0,
      referredUsersCount,
      recentReferredUsers,
      recentEarnings: referralEarnings.map((r) => ({
        _id: r._id,
        bookingReference: r.bookingReference,
        sourceType: r.sourceType,
        referredUser: r.referredUser,
        eventId: r.eventId,
        eventCenterId: r.eventCenterId,
        totalAmount: r.totalAmount,
        commissionPercentage: r.commissionPercentage,
        commissionAmount: r.commissionAmount,
        status: r.status,
        currency: r.currency || "NGN",
        createdAt: r.createdAt,
      })),
    };

    referralEarnings.forEach((r) => {
      if (r.status === "COMPLETED") affiliationStats.totalEarnings += (r.commissionAmount || 0);
      if (r.status === "PENDING") affiliationStats.pendingEarnings += (r.commissionAmount || 0);
      if (r.status === "REFUNDED") affiliationStats.refundedEarnings += (r.commissionAmount || 0);
    });

    affiliationStats.totalEarnings = Math.max(affiliationStats.totalEarnings, user.referralEarnings || 0);

    // 7. Aggregate Ticket Scans & Check-In Analytics
    const [venueScansPerformedCount, totalEventScansCount, attendeeEventScansCount, totalEventTicketsIssued, attendeeVenueScansCount] = await Promise.all([
      EventCenterBooking.countDocuments({
        "checkIn.checkedInBy": userObjectId,
        "checkIn.isCheckedIn": true,
      }),
      UserEventTicket.countDocuments({
        "checkIn.checkedInBy": userObjectId,
        "checkIn.isCheckedIn": true,
      }),
      organisedEventIds.length
        ? UserEventTicket.countDocuments({
            eventId: { $in: organisedEventIds },
            "checkIn.isCheckedIn": true,
          })
        : 0,
      organisedEventIds.length
        ? UserEventTicket.countDocuments({
            eventId: { $in: organisedEventIds },
          })
        : 0,
      organisedCenterIds.length
        ? EventCenterBooking.countDocuments({
            eventCenter: { $in: organisedCenterIds },
            "checkIn.isCheckedIn": true,
          })
        : 0,
    ]);

    const totalScansPerformed = totalEventScansCount + venueScansPerformedCount;
    const userTicketsCheckedInCount = userTicketsOwned.filter((t) => t.checkIn?.isCheckedIn || t.status === "REDEEMED").length;

    const ticketScansStats = {
      scansPerformedCount: totalScansPerformed,
      attendeeEventScansCount,
      totalEventTicketsIssued,
      attendeeVenueScansCount,
      userTicketsOwnedCount: userTicketsOwned.length,
      userTicketsCheckedInCount,
      recentScansPerformed: scansPerformed.map((s) => ({
        _id: s._id,
        ticketNumber: s.ticketNumber,
        ticketName: s.ticketName,
        eventId: s.eventId,
        attendee: s.owner,
        checkedInAt: s.checkIn?.checkedInAt || s.createdAt,
        method: s.checkIn?.method || "QR",
      })),
      userTickets: userTicketsOwned.map((t) => ({
        _id: t._id,
        ticketNumber: t.ticketNumber,
        ticketName: t.ticketName,
        status: t.status,
        eventId: t.eventId,
        isCheckedIn: Boolean(t.checkIn?.isCheckedIn || t.status === "REDEEMED"),
        checkedInAt: t.checkIn?.checkedInAt,
        price: t.ticketSnapshot?.price,
        createdAt: t.createdAt,
      })),
    };

    // 8. Annotate user's events and venues with roles
    const annotatedEvents = events.map((event) => {
      const isCreator = String(event.createdBy?._id || event.createdBy) === userObjectIdStr;
      const isCo = Array.isArray(event.coOrganisers) && event.coOrganisers.some((co) => String(co?._id || co) === userObjectIdStr);
      return {
        ...event,
        userRole: isCreator ? "Creator" : isCo ? "Co-organiser" : "Staff",
      };
    });

    const annotatedEventCenters = eventCenters.map((center) => {
      const isCreator = String(center.createdBy?._id || center.createdBy) === userObjectIdStr;
      const isCo = Array.isArray(center.coOrganisers) && center.coOrganisers.some((co) => String(co?._id || co) === userObjectIdStr);
      return {
        ...center,
        userRole: isCreator ? "Owner" : isCo ? "Co-manager" : "Staff",
      };
    });

    // 9. High-level Summary Metrics
    const summary = {
      dayJoined: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      isActive: user.isActive,
      authProvider: user.authProvider || "local",
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      isIdentityVerified: user.isIdentityVerified,
      totalEventsOrganised: annotatedEvents.length,
      totalEventCentersOwned: annotatedEventCenters.length,
      totalTicketSalesRevenue: ticketSalesStats.grossRevenue,
      totalTicketSalesNet: ticketSalesStats.netPayout,
      totalTicketsSold: ticketSalesStats.totalTicketsSold,
      totalVenueBookingRevenue: venueBookingsStats.grossRevenue,
      totalVenueBookingNet: venueBookingsStats.netPayout,
      totalVenueBookingsCount: venueBookingsStats.completedBookingsCount,
      totalReferralEarnings: affiliationStats.totalEarnings,
      totalReferredUsers: affiliationStats.referredUsersCount,
      totalScansPerformed: ticketScansStats.scansPerformedCount,
      totalAttendeeScansReceived: attendeeEventScansCount + attendeeVenueScansCount,
    };

    res.status(200).json({
      success: true,
      data: {
        user,
        summary,
        events: annotatedEvents,
        eventCenters: annotatedEventCenters,
        earnings: {
          ticketSales: ticketSalesStats,
          venueBookings: venueBookingsStats,
          affiliation: affiliationStats,
        },
        ticketScans: ticketScansStats,
        customerActivity: {
          eventBookings: customerEventBookings,
          venueBookings: customerVenueBookings,
        },
        auditLogs,
        // Legacy compatibility properties
        eventBookings: customerEventBookings,
        venueBookings: customerVenueBookings,
      },
    });
  } catch (error) {
    console.error("[ADMIN GET USER DETAILS ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching user details" });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, reason } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (typeof isActive !== "boolean") {
      return res
        .status(400)
        .json({ success: false, message: "isActive boolean is required" });
    }

    if (!isActive && !reason?.trim()) {
      return res.status(400).json({
        success: false,
        message: "A suspension reason is required",
      });
    }

    if (!isActive && String(id) === String(req.user?.id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot suspend your own account",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const previousValue = { isActive: user.isActive };
    user.isActive = isActive;
    if (!isActive) { user.refreshToken = ""; user.$inc("sessionVersion", 1); }
    await user.save();

    await recordAdminAction({
      req,
      action: isActive ? "USER_REACTIVATED" : "USER_SUSPENDED",
      targetType: "User",
      targetId: user._id,
      previousValue,
      newValue: { isActive },
      metadata: { reason },
    });

    res.status(200).json({
      success: true,
      message: isActive ? "User reactivated" : "User suspended",
      data: { user: { id: user._id, isActive: user.isActive } },
    });
  } catch (error) {
    console.error("[ADMIN UPDATE USER STATUS ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error updating user status" });
  }
};

const updateUserVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { isEmailVerified, isPhoneVerified, isIdentityVerified } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID" });
    }

    if (
      ![isEmailVerified, isPhoneVerified, isIdentityVerified].some(
        (value) => typeof value === "boolean",
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one verification field is required",
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const previousValue = {
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      isIdentityVerified: user.isIdentityVerified,
    };

    if (typeof isEmailVerified === "boolean") {
      user.isEmailVerified = isEmailVerified;
      user.emailVerifiedAt = isEmailVerified ? new Date() : null;
    }
    if (typeof isPhoneVerified === "boolean") {
      user.isPhoneVerified = isPhoneVerified;
      user.phoneVerifiedAt = isPhoneVerified ? new Date() : null;
    }
    if (typeof isIdentityVerified === "boolean") {
      user.isIdentityVerified = isIdentityVerified;
    }

    await user.save();

    await recordAdminAction({
      req,
      action: "USER_VERIFICATION_UPDATED",
      targetType: "User",
      targetId: user._id,
      previousValue,
      newValue: {
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        isIdentityVerified: user.isIdentityVerified,
      },
    });

    res.status(200).json({ success: true, message: "Verification updated" });
  } catch (error) {
    console.error("[ADMIN UPDATE USER VERIFICATION ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error updating verification" });
  }
};

module.exports = {
  getUsers,
  getUserDetails,
  updateUserStatus,
  updateUserVerification,
};
