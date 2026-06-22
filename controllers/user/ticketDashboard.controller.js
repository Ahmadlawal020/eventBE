const Event = require("../../models/user/event.schema");
const Ticket = require("../../models/user/eventTicketType.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");
const EventBooking = require("../../models/user/eventBooking.schema");
const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");

/**
 * @desc    Get aggregate ticket statistics for an organiser across all their events
 * @route   GET /api/organiser/ticket-stats
 * @access  Private (Organiser only)
 */
const getOrganiserTicketStats = async (req, res) => {
  const organiserId = req.user.id;

  try {
    // 1. Find all events managed by this organiser (Created or Co-hosted, NOT where user is staff)
    const eventsRaw = await Event.find({
      $or: [
        { createdBy: organiserId },
        { coHosts: organiserId },
      ],
      staff: { $ne: organiserId },
    })
      .select("_id title status schedule location performance images createdBy")
      .sort({ "schedule.from": -1 })
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
          if (item.listingType === "Event" && item.listingId) {
            permissionsMap[item.listingId.toString()] = invite.permissions || [];
          }
        });
      }
    });
    staffInvites.forEach(invite => {
      if (invite.listings) {
        invite.listings.forEach(item => {
          if (item.listingType === "Event" && item.listingId) {
            permissionsMap[item.listingId.toString()] = invite.permissions || [];
          }
        });
      }
    });

    const events = eventsRaw.map(event => {
      const isOwner = event.createdBy && event.createdBy.toString() === organiserId.toString();
      const userPerms = permissionsMap[event._id.toString()] || [];
      const hasFinancePerm = isOwner || userPerms.includes("VIEW_FINANCES") || userPerms.includes("ALL_ACCESS");

      return {
        ...event,
        hasFinancePerm
      };
    });

    const eventIds = events.map((e) => e._id);
    const financeEventIds = events.filter(e => e.hasFinancePerm).map(e => e._id);

    if (eventIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          aggregate: {
            totalCapacity: 0,
            totalTickets: 0,
            totalSold: 0,
            remainingTickets: 0,
            totalRedeemed: 0,
            turnOutRate: "0%",
            totalExpired: 0,
            totalRefunded: 0,
            failedTickets: 0,
            grossRevenue: 0,
            netRevenue: 0,
            avgTicketPrice: 0,
            salesVelocity: { last24h: 0, last7d: 0, last30d: 0 },
            hasGlobalFinancePerm: false
          },
          distribution: [],
          hourlyCheckIns: [],
          events: [],
        },
      });
    }

    // 2. Aggregate Inventory, Gross Revenue, and Net Revenue
    const inventoryStats = await Ticket.aggregate([
      { $match: { eventId: { $in: eventIds } } },
      {
        $group: {
          _id: "$eventId",
          totalQuantity: { $sum: "$totalQuantity" },
          soldQuantity: { $sum: "$soldQuantity" },
          grossRevenueCents: {
            $sum: {
              $cond: [
                { $eq: ["$ticketType", "PAID"] },
                { $multiply: ["$soldQuantity", { $ifNull: ["$price.amountCents", 0] }] },
                0,
              ],
            },
          },
          netRevenueCents: {
            $sum: {
              $cond: [
                { $eq: ["$ticketType", "PAID"] },
                {
                  $let: {
                    vars: {
                      gross: { $multiply: ["$soldQuantity", { $ifNull: ["$price.amountCents", 0] }] },
                      commPerc: { $divide: [{ $ifNull: ["$commission.percentage", 0] }, 100] },
                    },
                    in: {
                      $cond: [
                        { $eq: ["$commission.type", "DEDUCT_FROM_PRICE"] },
                        { $subtract: ["$$gross", { $multiply: ["$$gross", "$$commPerc"] }] },
                        "$$gross", // For ADD_ON, organiser gets the full price
                      ],
                    },
                  },
                },
                0,
              ],
            },
          },
        },
      },
    ]);

    const inventoryMap = {};
    let aggTotalCapacity = 0;
    let aggTotalSold = 0;
    let aggGrossRevenueCents = 0;
    let aggNetRevenueCents = 0;

    inventoryStats.forEach((stat) => {
      inventoryMap[stat._id.toString()] = stat;
      
      const eventWithPerm = events.find(e => e._id.toString() === stat._id.toString());
      const hasFinance = eventWithPerm ? eventWithPerm.hasFinancePerm : false;

      aggTotalCapacity += stat.totalQuantity;
      aggTotalSold += stat.soldQuantity;
      
      if (hasFinance) {
        aggGrossRevenueCents += stat.grossRevenueCents;
        aggNetRevenueCents += stat.netRevenueCents;
      } else {
        stat.grossRevenueCents = 0;
        stat.netRevenueCents = 0;
      }
    });

    // 3. Aggregate Redemption, Refunds, Expirations
    const now = new Date();
    const ticketStats = await UserEventTicket.aggregate([
      { $match: { eventId: { $in: eventIds } } },
      {
        $group: {
          _id: "$eventId",
          redeemed: { $sum: { $cond: [{ $eq: ["$status", "REDEEMED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          expired: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "UNREDEEMED"] },
                    { $lt: ["$eventSnapshot.schedule.endDate", now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const ticketStatusMap = {};
    let aggRedeemed = 0;
    let aggCancelled = 0;
    let aggExpired = 0;

    ticketStats.forEach((stat) => {
      ticketStatusMap[stat._id.toString()] = stat;
      aggRedeemed += stat.redeemed;
      aggCancelled += stat.cancelled;
      aggExpired += stat.expired;
    });

    // 4. Ticket Distribution by Tier (Name)
    const distribution = await Ticket.aggregate([
      { $match: { eventId: { $in: financeEventIds } } },
      {
        $group: {
          _id: "$name",
          sold: { $sum: "$soldQuantity" },
          total: { $sum: "$totalQuantity" },
        },
      },
      { $sort: { sold: -1 } },
      {
        $project: {
          tier: "$_id",
          sold: 1,
          total: 1,
          _id: 0,
        },
      },
    ]);

    // 5. Hourly Check-in Breakdown (Last 24 Hours)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const hourlyCheckIns = await UserEventTicket.aggregate([
      {
        $match: {
          eventId: { $in: eventIds },
          status: "REDEEMED",
          redeemedAt: { $gte: twentyFourHoursAgo },
        },
      },
      {
        $group: {
          _id: { $hour: "$redeemedAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          hour: "$_id",
          count: 1,
          _id: 0,
        },
      },
    ]);

    // 6. Booking Failures
    const bookingStats = await EventBooking.aggregate([
      { $match: { eventId: { $in: eventIds }, paymentStatus: "FAILED" } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    const failedTickets = bookingStats[0]?.count || 0;

    // 7. Sales Velocity
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const velocityStats = await UserEventTicket.aggregate([
      {
        $match: {
          eventId: { $in: eventIds },
          status: { $ne: "CANCELLED" },
          createdAt: { $gte: last30Days },
        },
      },
      {
        $group: {
          _id: null,
          last24h: { $sum: { $cond: [{ $gte: ["$createdAt", yesterday] }, 1, 0] } },
          last7d: { $sum: { $cond: [{ $gte: ["$createdAt", last7Days] }, 1, 0] } },
          last30d: { $sum: 1 },
        },
      },
    ]);
    const salesVelocity = velocityStats[0] || { last24h: 0, last7d: 0, last30d: 0 };
    delete salesVelocity._id;

    // 8. Format Event List
    const eventList = events.map((event) => {
      const inv = inventoryMap[event._id.toString()] || { totalQuantity: 0, soldQuantity: 0, grossRevenueCents: 0 };
      const status = ticketStatusMap[event._id.toString()] || { redeemed: 0, cancelled: 0, expired: 0 };

      return {
        id: event._id,
        title: event.title,
        status: event.status,
        image: event.images?.[0]?.url || "",
        date: event.schedule?.from,
        hasFinancePerm: event.hasFinancePerm,
        tickets: {
          total: inv.totalQuantity,
          sold: inv.soldQuantity,
          remaining: Math.max(0, inv.totalQuantity - inv.soldQuantity),
          redeemed: status.redeemed,
          cancelled: status.cancelled,
          expired: status.expired,
          grossRevenue: event.hasFinancePerm ? inv.grossRevenueCents / 100 : null,
        },
      };
    });

    // 9. Final Response
    const avgTicketPrice = financeEventIds.length > 0 && aggTotalSold > 0 ? (aggGrossRevenueCents / aggTotalSold / 100).toFixed(2) : 0;
    const turnOutRate = aggTotalSold > 0 ? ((aggRedeemed / aggTotalSold) * 100).toFixed(1) + "%" : "0%";

    res.status(200).json({
      success: true,
      data: {
        aggregate: {
          totalCapacity: aggTotalCapacity,
          totalSold: aggTotalSold,
          remainingTickets: Math.max(0, aggTotalCapacity - aggTotalSold),
          totalRedeemed: aggRedeemed,
          turnOutRate,
          totalExpired: aggExpired,
          totalRefunded: aggCancelled,
          failedTickets,
          grossRevenue: financeEventIds.length > 0 ? aggGrossRevenueCents / 100 : null,
          netRevenue: financeEventIds.length > 0 ? aggNetRevenueCents / 100 : null,
          avgTicketPrice: financeEventIds.length > 0 ? Number(avgTicketPrice) : null,
          salesVelocity,
          hasGlobalFinancePerm: financeEventIds.length > 0
        },
        distribution,
        hourlyCheckIns,
        events: eventList,
      },
    });
  } catch (error) {
    console.error("[GET ORGANISER TICKET STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching statistics" });
  }
};



/**
 * @desc    Get detailed ticket statistics for a single event
 * @route   GET /api/organiser/ticket-stats/:eventId
 * @access  Private (Organiser/Co-host/Staff)
 */
const getSingleEventTicketStats = async (req, res) => {
  const { eventId } = req.params;
  const organiserId = req.user.id;

  try {
    // 1. Verify access to the event
    const event = await Event.findOne({
      _id: eventId,
      $or: [
        { createdBy: organiserId },
        { coHosts: organiserId },
        { staff: organiserId },
      ],
    }).select("_id title status schedule location images createdBy").lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found or access denied" });
    }

    let hasFinancePerm = true;
    if (event.createdBy && event.createdBy.toString() !== organiserId.toString()) {
      const [coHostInvite, staffInvite] = await Promise.all([
        CoHostInvitation.findOne({ coHost: organiserId, status: "ACCEPTED", "listings.listingId": eventId }).lean(),
        StaffInvitation.findOne({ staff: organiserId, status: "ACCEPTED", "listings.listingId": eventId }).lean(),
      ]);

      const userPerms = (coHostInvite?.permissions || []).concat(staffInvite?.permissions || []);
      hasFinancePerm = userPerms.includes("VIEW_FINANCES") || userPerms.includes("ALL_ACCESS");
    }

    // 2. Aggregate Inventory and Revenue for this event
    const inventoryStats = await Ticket.aggregate([
      { $match: { eventId: event._id } },
      {
        $group: {
          _id: "$eventId",
          totalQuantity: { $sum: "$totalQuantity" },
          soldQuantity: { $sum: "$soldQuantity" },
          grossRevenueCents: {
            $sum: {
              $cond: [
                { $eq: ["$ticketType", "PAID"] },
                { $multiply: ["$soldQuantity", { $ifNull: ["$price.amountCents", 0] }] },
                0,
              ],
            },
          },
          netRevenueCents: {
            $sum: {
              $cond: [
                { $eq: ["$ticketType", "PAID"] },
                {
                  $let: {
                    vars: {
                      gross: { $multiply: ["$soldQuantity", { $ifNull: ["$price.amountCents", 0] }] },
                      commPerc: { $divide: [{ $ifNull: ["$commission.percentage", 0] }, 100] },
                    },
                    in: {
                      $cond: [
                        { $eq: ["$commission.type", "DEDUCT_FROM_PRICE"] },
                        { $subtract: ["$$gross", { $multiply: ["$$gross", "$$commPerc"] }] },
                        "$$gross",
                      ],
                    },
                  },
                },
                0,
              ],
            },
          },
        },
      },
    ]);

    const inv = inventoryStats[0] || { totalQuantity: 0, soldQuantity: 0, grossRevenueCents: 0, netRevenueCents: 0 };

    // 3. Aggregate Redemption, Refunds, Expirations
    const now = new Date();
    const ticketStats = await UserEventTicket.aggregate([
      { $match: { eventId: event._id } },
      {
        $group: {
          _id: "$eventId",
          redeemed: { $sum: { $cond: [{ $eq: ["$status", "REDEEMED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          expired: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "UNREDEEMED"] },
                    { $lt: ["$eventSnapshot.schedule.endDate", now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const tStats = ticketStats[0] || { redeemed: 0, cancelled: 0, expired: 0 };

    // 4. Distribution by Tier
    const distribution = await Ticket.find({ eventId: event._id })
      .select("name totalQuantity soldQuantity price ticketType commission")
      .lean();

    // Get redemption stats per ticket type
    const redemptionPerTier = await UserEventTicket.aggregate([
      { $match: { eventId: event._id } },
      {
        $group: {
          _id: "$ticketTypeId",
          redeemed: { $sum: { $cond: [{ $eq: ["$status", "REDEEMED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
        }
      }
    ]);

    const redemptionMap = {};
    redemptionPerTier.forEach(r => {
      redemptionMap[r._id.toString()] = r;
    });

    const formattedDistribution = distribution.map(t => {
      const red = redemptionMap[t._id.toString()] || { redeemed: 0, cancelled: 0 };
      const price = (t.price?.amountCents || 0) / 100;
      const grossRevenue = t.ticketType === 'PAID' ? (t.soldQuantity * price) : 0;
      
      // Calculate net revenue for this tier
      let netRevenue = grossRevenue;
      if (t.ticketType === 'PAID' && t.commission) {
        const commPerc = (t.commission.percentage || 0) / 100;
        if (t.commission.type === 'DEDUCT_FROM_PRICE') {
          netRevenue = grossRevenue * (1 - commPerc);
        }
      }

      return {
        id: t._id,
        tier: t.name,
        sold: t.soldQuantity,
        total: t.totalQuantity,
        price: hasFinancePerm ? price : null,
        type: t.ticketType,
        redeemed: red.redeemed,
        cancelled: red.cancelled,
        grossRevenue: hasFinancePerm ? grossRevenue : null,
        netRevenue: hasFinancePerm ? netRevenue : null
      };
    });

    // 5. Sales Velocity for this event
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const velocityStats = await UserEventTicket.aggregate([
      {
        $match: {
          eventId: event._id,
          status: { $ne: "CANCELLED" },
          createdAt: { $gte: last30Days },
        },
      },
      {
        $group: {
          _id: null,
          last24h: { $sum: { $cond: [{ $gte: ["$createdAt", yesterday] }, 1, 0] } },
          last7d: { $sum: { $cond: [{ $gte: ["$createdAt", last7Days] }, 1, 0] } },
          last30d: { $sum: 1 },
        },
      },
    ]);
    const salesVelocity = velocityStats[0] || { last24h: 0, last7d: 0, last30d: 0 };
    delete salesVelocity._id;

    // 6. Response
    const avgTicketPrice = inv.soldQuantity > 0 ? (inv.grossRevenueCents / inv.soldQuantity / 100).toFixed(2) : 0;
    const turnOutRate = inv.soldQuantity > 0 ? ((tStats.redeemed / inv.soldQuantity) * 100).toFixed(1) + "%" : "0%";

    res.status(200).json({
      success: true,
      data: {
        event: {
          id: event._id,
          title: event.title,
          status: event.status,
          image: event.images?.[0]?.url || "",
          date: event.schedule?.from,
        },
        stats: {
          totalCapacity: inv.totalQuantity,
          totalSold: inv.soldQuantity,
          remainingTickets: Math.max(0, inv.totalQuantity - inv.soldQuantity),
          totalRedeemed: tStats.redeemed,
          turnOutRate,
          totalExpired: tStats.expired,
          totalCancelled: tStats.cancelled,
          grossRevenue: hasFinancePerm ? inv.grossRevenueCents / 100 : null,
          netRevenue: hasFinancePerm ? inv.netRevenueCents / 100 : null,
          avgTicketPrice: hasFinancePerm ? Number(avgTicketPrice) : null,
          salesVelocity,
        },
        distribution: formattedDistribution,
        hasFinancePerm
      },
    });
  } catch (error) {
    console.error("[GET SINGLE EVENT TICKET STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching statistics" });
  }
};

/**
 * @desc    Get list of attendees/tickets for a single event
 * @route   GET /api/organiser/ticket-stats/:eventId/attendees
 * @access  Private (Organiser/Co-host/Staff)
 */
const getEventAttendees = async (req, res) => {
  const { eventId } = req.params;
  const { tier, status, search } = req.query;
  const organiserId = req.user.id;

  try {
    // 1. Verify access to the event
    const event = await Event.findOne({
      _id: eventId,
      $or: [
        { createdBy: organiserId },
        { coHosts: organiserId },
        { staff: organiserId },
      ],
    }).select("_id title").lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found or access denied" });
    }

    // 2. Build Query
    const query = { eventId: event._id };
    if (tier) query.ticketName = tier;
    
    if (status === 'SCANNED') {
      query.status = 'REDEEMED';
    } else if (status === 'BOUGHT') {
      query.status = { $in: ['UNREDEEMED', 'REDEEMED'] };
    } else if (status === 'CANCELLED') {
      query.status = 'CANCELLED';
    }

    // Add search functionality if needed
    // if (search) {
    //   query.$or = [
    //     { ticketNumber: { $regex: search, $options: 'i' } },
    //     { 'owner.email': { $regex: search, $options: 'i' } }
    //   ];
    // }

    const attendees = await UserEventTicket.find(query)
      .populate('owner', 'firstName lastName email profileImage')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: attendees
    });
  } catch (error) {
    console.error("[GET EVENT ATTENDEES ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching attendees" });
  }
};

module.exports = {
  getOrganiserTicketStats,
  getSingleEventTicketStats,
  getEventAttendees,
};
