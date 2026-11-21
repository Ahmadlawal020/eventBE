const { attendanceForBookings } = require("../../services/bookingAttendance.service");
const { getManualBookings, manualCollectedAmount } = require("../../services/manualBookingRead.service");
const EventCenter = require("../../models/client/eventCenter.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const mongoose = require("mongoose");
const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/client/staffInvitation.schema");

/**
 * @desc    Get aggregate booking statistics for an organiser across all their event centers
 * @route   GET /api/organiser/booking-stats
 * @access  Private (Organiser only)
 */
const getOrganiserBookingStats = async (req, res) => {
  const organiserId = req.user.id;

  try {
    // 1. Find all event centers managed by this organiser (Created or Co-organised, NOT where user is staff)
    const venuesRaw = await EventCenter.find({
      $or: [
        { createdBy: organiserId },
        { coOrganisers: organiserId },
      ],
      staff: { $ne: organiserId },
    })
      .select("_id venueName status location images venueType performance createdBy availability basePrice createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    // Fetch accepted invitations for co-organiser and staff to check permissions
    const [coOrganiserInvites, staffInvites] = await Promise.all([
      CoOrganiserInvitation.find({ coOrganiser: organiserId, status: "ACCEPTED" }).lean(),
      StaffInvitation.find({ staff: organiserId, status: "ACCEPTED" }).lean(),
    ]);

    const permissionsMap = {};
    coOrganiserInvites.forEach(invite => {
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
                activeBookings: { $sum: { $cond: [{ $in: ["$status", ["ACTIVE", "CONFIRMED"]] }, 1, 0] } },
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

    const manualBookings = await getManualBookings(venues);
    const financeIds = new Set(financeVenueIds.map(String));
    const addRevenue = (rows, key, amount) => {
      const row = rows.find(item => item._id === key);
      if (row) row.revenue += amount;
      else rows.push({ _id: key, revenue: amount });
    };
    for (const booking of manualBookings) {
      agg.totalBookings++;
      if (booking.status === "ACTIVE") agg.activeBookings++;
      if (booking.status === "COMPLETED") agg.completedBookings++;
      if (booking.status === "CANCELLED") agg.cancelledBookings++;
      if (booking.checkIn.isCheckedIn) { agg.totalCheckedIn++; agg.manualCheckIn++; }
      if (financeIds.has(String(booking.eventCenter._id))) {
        const collected = manualCollectedAmount(booking);
        agg.totalRevenue += collected;
        if (booking.status !== "CANCELLED" && booking.paymentStatus !== "COMPLETED") {
          agg.pendingRevenue += Math.max(0, booking.totalPrice.amount - collected);
          agg.pendingPayments++;
        }
        if (collected) {
          addRevenue(facetData.revenueByCurrency, booking.totalPrice.currency, collected);
          addRevenue(facetData.revenueByBookingUnit, booking.bookingUnit, collected);
        }
      }
    }

    const venueMoney = await require("../../services/venueMoney.service").loadVenueMoney(financeVenueIds, manualBookings);
    const finance = venueMoney.currencies.length === 1 ? venueMoney.currencies[0] : venueMoney.currencies.length === 0 ? { netReceipts: 0, grossCollections: 0, fees: 0, refundsSent: 0, refundsConfirmed: 0, refundLiability: 0 } : null;
    agg.totalRevenue = finance?.netReceipts ?? null;
    agg.grossCollections = finance?.grossCollections ?? null;
    agg.platformFees = finance?.fees ?? null;
    agg.refundsSent = finance?.refundsSent ?? null;
    agg.refundsConfirmed = finance?.refundsConfirmed ?? null;
    agg.refundLiability = finance?.refundLiability ?? null;
    agg.moneyByCurrency = venueMoney.currencies;
    agg.moneyBreakdownByCurrency = venueMoney.breakdown;
    facetData.revenueByCurrency = venueMoney.currencies.map(r => ({ _id: r.currency, revenue: r.netReceipts }));
    facetData.revenueByBookingUnit = venueMoney.byUnit;
    const attendanceBookings = await attendanceForBookings([
      ...await EventCenterBooking.find({ eventCenter: { $in: venueIds } }).select("_id eventCenter selectedDates bookingUnit status checkIn").lean(),
      ...manualBookings,
    ]);
    agg.totalCheckedIn = attendanceBookings.filter(b => b.attendance.summary.attended > 0).length;
    const attendedByMethod = method => attendanceBookings.filter(b => b.attendance.sessions.some(session =>
      session.status === "ATTENDED" && session.audit[session.audit.length - 1]?.method === method)).length;
    agg.qrCheckIn = attendedByMethod("QR");
    agg.manualCheckIn = attendedByMethod("MANUAL");

    const attendanceActors = new Map();
    for (const booking of attendanceBookings) {
      for (const session of booking.attendance.sessions) {
        const audit = session.audit[session.audit.length - 1];
        if (session.status === "ATTENDED" && audit?.actor) {
          const id = String(audit.actor._id || audit.actor);
          attendanceActors.set(id, (attendanceActors.get(id) || 0) + 1);
        }
      }
    }
    facetData.staffEfficiency = [...attendanceActors].map(([_id, count]) => ({ _id, count })).sort((a, b) => b.count - a.count).slice(0, 5);

    const avgBookingValue = financeVenueIds.length > 0 && agg.totalBookings > 0 ? (Number(agg.totalRevenue || 0) / agg.totalBookings).toFixed(2) : null;

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

    for (const booking of manualBookings) {
      const key = String(booking.eventCenter._id);
      const stats = venueStatsMap[key] ||= { count: 0, revenue: 0, checkedIn: 0, pendingReview: 0 };
      stats.count++;
      stats.revenue += manualCollectedAmount(booking);
      if (booking.checkIn.isCheckedIn) stats.checkedIn++;
    }
    for (const [id, money] of venueMoney.perVenue) {
      if (venueStatsMap[id]) venueStatsMap[id].revenue = money.length === 1 ? money[0].netReceipts : null;
    }
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
          checkedIn: attendanceBookings.filter(b => String(b.eventCenter?._id || b.eventCenter) === String(v._id) && b.attendance.summary.attended > 0).length,
          pendingReview: stats.pendingReview,
        },
      };
    });

    // 4. Fetch pending review bookings and pending reschedule requests across all venues
    const [pendingRequests, pendingReschedules] = await Promise.all([
      EventCenterBooking.find({
        eventCenter: { $in: venueIds },
        status: "PENDING_REVIEW",
      })
        .populate("buyer", "firstName surname email profilePicture profileImage")
        .populate("eventCenter", "venueName")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      EventCenterBooking.find({
        eventCenter: { $in: venueIds },
        status: { $in: ["ACTIVE", "CONFIRMED"] },
        "rescheduleRequest.status": "PENDING",
      })
        .populate("buyer", "firstName surname email profilePicture profileImage")
        .populate("eventCenter", "venueName")
        .sort({ "rescheduleRequest.requestedAt": -1, updatedAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const extractAvatar = (buyer) => {
      if (!buyer) return null;
      if (typeof buyer.profilePicture === "string") return buyer.profilePicture;
      if (typeof buyer.profilePicture?.url === "string") return buyer.profilePicture.url;
      if (typeof buyer.profileImage === "string") return buyer.profileImage;
      return null;
    };

    const pendingRequestsList = pendingRequests.map((t) => ({
      bookingId: String(t._id),
      guestName: t.guestDetails?.fullName || (t.buyer ? `${t.buyer.firstName} ${t.buyer.surname}` : ""),
      guestEmail: t.guestDetails?.email || t.buyer?.email || "",
      guestImage: extractAvatar(t.buyer),
      venueName: t.eventCenter?.venueName || "",
      venueId: t.eventCenter?._id || t.eventCenter,
      selectedDates: t.selectedDates || [],
      bookingUnit: t.bookingUnit,
      duration: t.duration,
      totalPrice: t.totalPrice,
      subtotalPrice: t.subtotalPrice,
      organiserPayoutAmount:
        t.organiserPayoutAmount ??
        t.subtotalPrice?.amount ??
        Math.max(0, Number(t.totalPrice?.amount || 0) - Number(t.platformFeeAmount || 0)),
      reviewDeadline: t.reviewDeadline,
      createdAt: t.createdAt,
    }));

    const pendingRescheduleList = pendingReschedules.map((t) => ({
      bookingId: String(t._id),
      requestId: t.rescheduleRequest?.id || "",
      guestName: t.guestDetails?.fullName || (t.buyer ? `${t.buyer.firstName} ${t.buyer.surname}` : ""),
      guestEmail: t.guestDetails?.email || t.buyer?.email || "",
      guestImage: extractAvatar(t.buyer),
      venueName: t.eventCenter?.venueName || "",
      venueId: t.eventCenter?._id || t.eventCenter,
      currentDates: t.selectedDates || [],
      requestedDates: t.rescheduleRequest?.dates || [],
      bookingUnit: t.bookingUnit,
      reason: t.rescheduleRequest?.reason || "",
      requestedAt: t.rescheduleRequest?.requestedAt || t.updatedAt,
    }));

    const totalPendingReview = pendingRequestsList.length;
    const totalPendingReschedules = pendingRescheduleList.length;

    // 5. Fetch outstanding reschedule refunds & balances across venues with finance permission
    let pendingRescheduleSettlements = [];
    if (financeVenueIds.length > 0) {
      const BookingOperations = require("../../models/client/bookingOperations.schema");
      const { outstanding } = require("../../services/rescheduleBalances.service");
      const opsRecords = await BookingOperations.find({
        eventCenter: { $in: financeVenueIds },
        rescheduleAdjustment: true,
      })
        .sort({ updatedAt: -1 })
        .limit(30)
        .lean();

      if (opsRecords.length > 0) {
        const platformIds = opsRecords
          .map((r) => r.bookingId)
          .filter((id) => mongoose.isValidObjectId(id));
        const platformBookings = platformIds.length
          ? await EventCenterBooking.find({
              _id: { $in: platformIds },
              eventCenter: { $in: financeVenueIds },
            }).lean()
          : [];
        const bookingsById = new Map([
          ...platformBookings.map((b) => [String(b._id), b]),
          ...manualBookings.map((b) => [String(b._id), b]),
        ]);
        const venueNameById = new Map(venues.map((v) => [String(v._id), v.venueName || ""]));

        for (const record of opsRecords) {
          const booking = bookingsById.get(String(record.bookingId));
          const item = booking && outstanding(booking, record);
          if (!item) continue;
          const vId = String(record.eventCenter);
          pendingRescheduleSettlements.push({
            ...item,
            venueId: vId,
            venueName: venueNameById.get(vId) || "",
            hasBankDetails: Boolean(record.refundAccount?.accountNumber),
            refundAccount: record.refundAccount?.accountNumber
              ? {
                  accountName: record.refundAccount.accountName || "",
                  accountNumber: record.refundAccount.accountNumber || "",
                  bankCode: record.refundAccount.bankCode || "",
                }
              : null,
            updatedAt: record.updatedAt,
          });
        }
      }
    }
    const pendingRescheduleSettlementCount = pendingRescheduleSettlements.length;

    // 6. Fetch pending direct cancellation refunds across venues with finance permission
    let pendingCancellationRefunds = [];
    if (financeVenueIds.length > 0) {
      const EventCenterRefund = require("../../models/client/eventCenterRefund.schema");
      const rawRefunds = await EventCenterRefund.find({
        eventCenterId: { $in: financeVenueIds },
        status: { $ne: "CONFIRMED_BY_BUYER" },
        ticketId: { $exists: true },
      })
        .populate("buyer", "firstName surname email profilePicture profileImage")
        .populate("eventCenterId", "venueName")
        .sort({ dueAt: 1, createdAt: -1 })
        .limit(20)
        .lean();

      pendingCancellationRefunds = rawRefunds.map((r) => ({
        refundId: String(r._id),
        bookingId: String(r.bookingId || r.ticketId),
        venueId: String(r.eventCenterId?._id || r.eventCenterId),
        venueName: r.eventCenterId?.venueName || r.resourceTitle || "",
        guestName: r.buyer ? `${r.buyer.firstName || ""} ${r.buyer.surname || ""}`.trim() || "Guest" : "Guest",
        guestImage: extractAvatar(r.buyer),
        amountMinor: r.amountMinor || 0,
        remainingMinor: Math.max(0, (r.amountMinor || 0) - (r.sentMinor || 0)),
        currency: r.currency || "NGN",
        status: r.status,
        hasBankDetails: Boolean(r.bankDetailsSubmittedAt),
        markedPaidAt: r.markedPaidAt || null,
        dueAt: r.dueAt || null,
      }));
    }
    const pendingCancellationRefundCount = pendingCancellationRefunds.length;

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
          pendingRescheduleCount: totalPendingReschedules,
          pendingRescheduleRequests: pendingRescheduleList,
          pendingRescheduleSettlementCount,
          pendingRescheduleSettlements,
          pendingCancellationRefundCount,
          pendingCancellationRefunds,
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
 * @access  Private (Organiser/Co-organiser/Staff)
 */
const getSingleVenueBookingStats = async (req, res) => {
  const { venueId } = req.params;
  const organiserId = req.user.id;

  try {
    const venue = await EventCenter.findOne({
      _id: venueId,
      $or: [
        { createdBy: organiserId },
        { coOrganisers: organiserId },
        { staff: organiserId },
      ],
    }).select("_id venueName images status createdBy bookingSettings availability basePrice createdAt updatedAt").lean();

    if (!venue) {
      return res.status(404).json({ success: false, message: "Venue not found or access denied" });
    }

    // Owner/creator has full access. Otherwise, verify permissions for co-organiser or staff.
    let hasFinancePerm = true;
    if (venue.createdBy && venue.createdBy.toString() !== organiserId.toString()) {
      const [coOrganiserInvite, staffInvite] = await Promise.all([
        CoOrganiserInvitation.findOne({ coOrganiser: organiserId, status: "ACCEPTED", "listings.listingId": venueId }).lean(),
        StaffInvitation.findOne({ staff: organiserId, status: "ACCEPTED", "listings.listingId": venueId }).lean(),
      ]);

      const userPerms = (coOrganiserInvite?.permissions || []).concat(staffInvite?.permissions || []);
      const hasFinancePermCheck = userPerms.includes("VIEW_FINANCES") || userPerms.includes("ALL_ACCESS");

      hasFinancePerm = hasFinancePermCheck;
    }

    const platformBookings = await EventCenterBooking.find({ eventCenter: venueId })
      .populate("buyer", "firstName surname email profileImage")
      .sort({ createdAt: -1 })
      .lean();

    const manualBookings = await getManualBookings([venue]);
    const bookings = (await attendanceForBookings([...platformBookings.map(booking => ({ ...booking, bookingType: "PLATFORM" })), ...manualBookings]))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const [opsRecords, cancelHistory] = await Promise.all([
      require("../../models/client/bookingOperations.schema")
        .find({ eventCenter: venue._id })
        .select("bookingId agreedPrice openingPaidMinor payments refunds rescheduleAdjustment")
        .lean(),
      require("../../models/client/bookingHistory.schema")
        .find({ eventCenter: venue._id, action: { $in: ["DECLINED", "EXPIRED", "CANCELLED"] } })
        .select("bookingId action reason createdAt")
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    const opsByBookingId = new Map(opsRecords.map((r) => [String(r.bookingId), r]));
    const cancelHistoryByBookingId = new Map();
    for (const entry of cancelHistory) {
      const key = String(entry.bookingId);
      if (!cancelHistoryByBookingId.has(key)) cancelHistoryByBookingId.set(key, entry);
    }
    const resolveCancellationOutcome = (b) => {
      if (b.status !== "CANCELLED") return null;
      const mode = b.cancellation?.mode;
      if (mode === "expire") return "EXPIRED";
      if (mode === "decline") return "DECLINED";
      if (mode === "withdraw") return "WITHDRAWN";
      const hist = cancelHistoryByBookingId.get(String(b._id));
      if (hist?.action === "EXPIRED") return "EXPIRED";
      if (hist?.action === "DECLINED") return "DECLINED";
      const actorId = b.cancellation?.actor ? String(b.cancellation.actor) : null;
      const buyerId = b.buyer?._id ? String(b.buyer._id) : b.buyer ? String(b.buyer) : null;
      if (actorId && buyerId && actorId === buyerId) return "GUEST_CANCELLED";
      if (actorId && buyerId && actorId !== buyerId) return "HOST_CANCELLED";
      if (b.bookingMode === "REVIEW" && b.reviewDeadline && new Date(b.reviewedAt || b.updatedAt || 0) >= new Date(b.reviewDeadline)) {
        return "EXPIRED";
      }
      return b.bookingType === "MANUAL" ? "HOST_CANCELLED" : "CANCELLED";
    };
    const { paymentSummary } = require("../../services/bookingOperations.service");
    const bookingsList = bookings.map(b => {
      const ops = opsByBookingId.get(String(b._id));
      const summary = paymentSummary(b, ops || {});
      const hasOutstandingBalance = summary.balanceMinor > 0;
      const cancellationOutcome = resolveCancellationOutcome(b);
      const organiserNetAmount =
        b.bookingType === "MANUAL"
          ? b.rescheduledPrice?.amount ?? b.totalPrice?.amount ?? 0
          : (b.rescheduledPrice?.amount != null
              ? Math.max(0, Number(b.rescheduledPrice.amount) - Number(b.platformFeeAmount || 0))
              : null) ??
            b.organiserPayoutAmount ??
            b.subtotalPrice?.amount ??
            Math.max(0, Number(b.totalPrice?.amount || 0) - Number(b.platformFeeAmount || 0));
      const balanceFields = {
        hasOutstandingBalance,
        hasRescheduleAdjustment: Boolean(ops?.rescheduleAdjustment),
        outstandingBalanceMinor: hasFinancePerm ? summary.balanceMinor : undefined,
        outstandingCurrency: summary.currency || b.totalPrice?.currency || "NGN",
        organiserNetAmount: hasFinancePerm ? organiserNetAmount : null,
        cancellationOutcome,
      };
      if (!hasFinancePerm) {
        return {
          ...b,
          ...balanceFields,
          depositAmount: null,
          manualFinance: undefined, rescheduledPrice: undefined, subtotalPrice: undefined, platformFeeAmount: undefined, buyerFeeAmount: undefined,
          organiserFeeAmount: undefined, organiserPayoutAmount: undefined, feePercentage: undefined, refund: undefined,
          totalPrice: {
            ...b.totalPrice,
            amount: null
          }
        };
      }
      return { ...b, ...balanceFields };
    });

    const refundRecords = hasFinancePerm ? await require("../../models/client/eventCenterRefund.schema")
      .find({ eventCenterId: venue._id }).select("amountMinor currency markedPaidAt status").lean() : [];
    if (hasFinancePerm) {
      const adjustments = opsRecords.filter((r) => r.rescheduleAdjustment);
      for (const booking of platformBookings) booking.rescheduleLedger = adjustments.find(a => a.bookingId === String(booking._id));
    }
    const financeRows = hasFinancePerm ? require("../../services/venueMoney.service").venueMoney(platformBookings, refundRecords, manualBookings) : [];
    for (const booking of platformBookings) delete booking.rescheduleLedger;
    // Aggregate stats for this specific venue
    const stats = {
      total: bookings.length,
      active: bookings.filter(b => b.status === 'ACTIVE' || b.status === 'CONFIRMED').length,
      pendingReview: bookings.filter(b => b.status === 'PENDING_REVIEW').length,
      checkedIn: bookings.filter(b => b.attendance.summary.attended > 0).length,
      revenue: hasFinancePerm && financeRows.length === 1 ? financeRows[0].netReceipts : null,
      moneyByCurrency: financeRows,
    };

    res.status(200).json({
      success: true,
      data: {
        venue: { _id: venue._id, venueName: venue.venueName, images: venue.images, status: venue.status, createdBy: venue.createdBy, bookingSettings: venue.bookingSettings },
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
