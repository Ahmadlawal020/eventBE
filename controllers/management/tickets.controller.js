const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const Ticket = require("../../models/client/eventTicketType.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listSort = (sort, issued = false) => {
  const common = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    name: issued ? { ticketName: 1 } : { name: 1 },
  };

  if (!issued && sort === "sales_end") return { salesEndAt: 1 };
  if (!issued && sort === "most_sold") return { soldQuantity: -1 };
  return common[sort] || common.newest;
};

const addSalesStatusFilter = (query, salesStatus) => {
  const now = new Date();

  if (salesStatus === "upcoming") {
    query.salesStartAt = { $gt: now };
  } else if (salesStatus === "on_sale") {
    query.$and = [
      { salesStartAt: { $lte: now } },
      { salesEndAt: { $gte: now } },
      { $expr: { $lt: ["$soldQuantity", "$totalQuantity"] } },
    ];
  } else if (salesStatus === "ended") {
    query.salesEndAt = { $lt: now };
  } else if (salesStatus === "sold_out") {
    query.$expr = { $gte: ["$soldQuantity", "$totalQuantity"] };
  }
};

const getTickets = async (req, res) => {
  try {
    const {
      search = "",
      ticketType,
      status,
      salesStatus,
      checkInStatus,
      sort = "newest",
      view = "ticket-types",
    } = req.query;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
    );
    const skip = (page - 1) * limit;
    const normalizedSearch = String(search).trim();
    const ticketTypeQuery = {};
    const issuedTicketQuery = {};

    if (ticketType && ["PAID", "FREE", "DONATION"].includes(ticketType)) {
      ticketTypeQuery.ticketType = ticketType;
    }
    if (status && ["UNREDEEMED", "REDEEMED", "CANCELLED"].includes(status)) {
      issuedTicketQuery.status = status;
    }
    if (checkInStatus === "checked_in") {
      issuedTicketQuery["checkIn.isCheckedIn"] = true;
    } else if (checkInStatus === "not_checked_in") {
      issuedTicketQuery["checkIn.isCheckedIn"] = { $ne: true };
    }

    addSalesStatusFilter(ticketTypeQuery, salesStatus);

    if (normalizedSearch) {
      const safeSearch = escapeRegex(normalizedSearch);
      const searchExpression = new RegExp(safeSearch, "i");
      const matchingEvents = await Event.find({ title: searchExpression })
        .select("_id")
        .lean();
      const matchingEventIds = matchingEvents.map((event) => event._id);

      ticketTypeQuery.$or = [
        { name: searchExpression },
        { groupName: searchExpression },
        { eventId: { $in: matchingEventIds } },
      ];
      issuedTicketQuery.$or = [
        { ticketName: searchExpression },
        { ticketNumber: searchExpression },
        { "eventSnapshot.title": searchExpression },
        { "eventSnapshot.organiser.name": searchExpression },
        { "eventSnapshot.organiser.email": searchExpression },
      ];
    }

    const [
      ticketTypes,
      issuedTickets,
      totalTicketTypes,
      totalIssuedTickets,
      ticketAnalyticsRows,
      issuedAnalyticsRows,
    ] = await Promise.all([
      Ticket.find(ticketTypeQuery)
        .populate("eventId", "title status createdBy images schedule")
        .sort(listSort(sort))
        .skip(skip)
        .limit(limit)
        .lean(),
      UserEventTicket.find(issuedTicketQuery)
        .select(
          "ticketName ticketNumber status owner eventSnapshot ticketSnapshot checkIn redeemedAt transferHistory createdAt updatedAt",
        )
        .populate("owner", "firstName surname email")
        .sort(listSort(sort, true))
        .skip(skip)
        .limit(limit)
        .lean(),
      Ticket.countDocuments(ticketTypeQuery),
      UserEventTicket.countDocuments(issuedTicketQuery),
      Ticket.aggregate([
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  ticketTypes: { $sum: 1 },
                  capacity: { $sum: "$totalQuantity" },
                  sold: { $sum: "$soldQuantity" },
                },
              },
            ],
            byKind: [
              {
                $group: {
                  _id: "$ticketType",
                  count: { $sum: 1 },
                  capacity: { $sum: "$totalQuantity" },
                  sold: { $sum: "$soldQuantity" },
                },
              },
              { $sort: { count: -1 } },
            ],
          },
        },
      ]),
      UserEventTicket.aggregate([
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  issuedTickets: { $sum: 1 },
                  checkedInTickets: {
                    $sum: { $cond: ["$checkIn.isCheckedIn", 1, 0] },
                  },
                  redeemedTickets: {
                    $sum: { $cond: [{ $eq: ["$status", "REDEEMED"] }, 1, 0] },
                  },
                  cancelledTickets: {
                    $sum: {
                      $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0],
                    },
                  },
                  transferredTickets: {
                    $sum: {
                      $cond: [
                        {
                          $gt: [
                            { $size: { $ifNull: ["$transferHistory", []] } },
                            0,
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            byStatus: [
              { $group: { _id: "$status", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ],
          },
        },
      ]),
    ]);

    const ticketAnalytics = ticketAnalyticsRows[0] || {
      summary: [],
      byKind: [],
    };
    const issuedAnalytics = issuedAnalyticsRows[0] || {
      summary: [],
      byStatus: [],
    };
    const inventory = ticketAnalytics.summary[0] || {
      ticketTypes: 0,
      capacity: 0,
      sold: 0,
    };
    const issuedSummary = issuedAnalytics.summary[0] || {
      issuedTickets: 0,
      checkedInTickets: 0,
      redeemedTickets: 0,
      cancelledTickets: 0,
      transferredTickets: 0,
    };
    const {
      issuedTickets: allIssuedTickets,
      checkedInTickets,
      redeemedTickets,
      cancelledTickets,
      transferredTickets,
    } = issuedSummary;
    const activeTotal =
      view === "issued-tickets" ? totalIssuedTickets : totalTicketTypes;

    return res.status(200).json({
      success: true,
      data: {
        metrics: {
          ticketTypes: inventory.ticketTypes,
          issuedTickets: allIssuedTickets,
          checkedInTickets,
          redeemedTickets,
          cancelledTickets,
          transferredTickets,
          totalCapacity: inventory.capacity,
          soldTickets: inventory.sold,
          availableInventory: Math.max(0, inventory.capacity - inventory.sold),
          sellThroughRate: inventory.capacity
            ? Math.round((inventory.sold / inventory.capacity) * 1000) / 10
            : 0,
          checkInRate: allIssuedTickets
            ? Math.round((checkedInTickets / allIssuedTickets) * 1000) / 10
            : 0,
        },
        ticketTypes,
        issuedTickets,
        issuedByStatus: issuedAnalytics.byStatus,
        typesByKind: ticketAnalytics.byKind,
        pagination: {
          total: activeTotal,
          totalTicketTypes,
          totalIssuedTickets,
          page,
          limit,
          pages: Math.ceil(activeTotal / limit),
          ticketTypePages: Math.ceil(totalTicketTypes / limit),
          issuedTicketPages: Math.ceil(totalIssuedTickets / limit),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN TICKETS ERROR]", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching tickets",
    });
  }
};

// @desc Get a ticket tier or an issued ticket with its operational context
// @route GET /api/admin/tickets/:id
const getTicketDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID",
      });
    }

    let ticket = await Ticket.findById(id)
      .populate({
        path: "eventId",
        select: "title status images location schedule createdBy",
        populate: {
          path: "createdBy",
          select: "firstName surname email phoneNumber profilePicture",
        },
      })
      .lean();

    if (ticket) {
      return res.status(200).json({
        success: true,
        data: { ticket, ticketType: "ticket-type" },
      });
    }

    ticket = await UserEventTicket.findById(id)
      .select(
        "bookingId eventId ticketTypeId ticketName ticketNumber status owner qrPayload eventSnapshot ticketSnapshot checkIn redeemedAt redeemedBy transferHistory createdAt updatedAt",
      )
      .populate("owner", "firstName surname email phoneNumber profilePicture")
      .populate(
        "bookingId",
        "paymentStatus paymentMethod totalAmount currency status createdAt",
      )
      .populate("ticketTypeId", "name ticketType")
      .populate("redeemedBy", "firstName surname email")
      .populate("checkIn.checkedInBy", "firstName surname email")
      .populate("transferHistory.fromUser", "firstName surname email")
      .populate("transferHistory.toUser", "firstName surname email")
      .lean();

    if (ticket) {
      const hasQrPayload = Boolean(ticket.qrPayload);
      delete ticket.qrPayload;
      return res.status(200).json({
        success: true,
        data: {
          ticket: { ...ticket, hasQrPayload },
          ticketType: "issued-ticket",
        },
      });
    }

    return res
      .status(404)
      .json({ success: false, message: "Ticket not found" });
  } catch (error) {
    console.error("[ADMIN GET TICKET DETAIL ERROR]", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching ticket detail",
    });
  }
};

module.exports = {
  getTickets,
  getTicketDetail,
};
