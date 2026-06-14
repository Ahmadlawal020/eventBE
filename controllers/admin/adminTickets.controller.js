const Ticket = require("../../models/user/eventTicket.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getTickets = async (req, res) => {
  try {
    const { search, ticketType, status, page = 1, limit = 25 } = req.query;

    const ticketTypeQuery = {};
    if (ticketType) ticketTypeQuery.ticketType = ticketType;
    if (search) {
      const safeSearch = escapeRegex(search);
      ticketTypeQuery.$or = [
        { name: new RegExp(safeSearch, "i") },
        { groupName: new RegExp(safeSearch, "i") },
      ];
    }

    const issuedTicketQuery = {};
    if (status) issuedTicketQuery.status = status;
    if (search) {
      const safeSearch = escapeRegex(search);
      issuedTicketQuery.$or = [
        { ticketName: new RegExp(safeSearch, "i") },
        { ticketNumber: new RegExp(safeSearch, "i") },
        { "eventSnapshot.title": new RegExp(safeSearch, "i") },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [
      ticketTypes,
      issuedTickets,
      totalTicketTypes,
      totalIssuedTickets,
      issuedByStatus,
      typesByKind,
      allTicketTypes,
      allIssuedTickets,
      checkedInTickets,
      redeemedTickets,
    ] = await Promise.all([
      Ticket.find(ticketTypeQuery)
        .populate("eventId", "title status createdBy")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      UserEventTicket.find(issuedTicketQuery)
        .select("ticketName ticketNumber status owner eventSnapshot ticketSnapshot checkIn redeemedAt createdAt")
        .populate("owner", "firstName surname email")
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .lean(),
      Ticket.countDocuments(ticketTypeQuery),
      UserEventTicket.countDocuments(issuedTicketQuery),
      UserEventTicket.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Ticket.aggregate([
        { $group: { _id: "$ticketType", count: { $sum: 1 }, capacity: { $sum: "$totalQuantity" }, sold: { $sum: "$soldQuantity" } } },
        { $sort: { count: -1 } },
      ]),
      Ticket.countDocuments(),
      UserEventTicket.countDocuments(),
      UserEventTicket.countDocuments({ "checkIn.isCheckedIn": true }),
      UserEventTicket.countDocuments({ status: "REDEEMED" }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        metrics: {
          ticketTypes: allTicketTypes,
          issuedTickets: allIssuedTickets,
          checkedInTickets,
          redeemedTickets,
        },
        ticketTypes,
        issuedTickets,
        issuedByStatus,
        typesByKind,
        pagination: {
          totalTicketTypes,
          totalIssuedTickets,
          page: Number(page),
          pages: Math.ceil(Math.max(totalTicketTypes, totalIssuedTickets) / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN TICKETS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching tickets" });
  }
};

// @desc Get single ticket detail
// @route GET /api/admin/tickets/:id
const getTicketDetail = async (req, res) => {
  try {
    const { id } = req.params;

    let ticket = await Ticket.findById(id)
      .populate("eventId", "title status images location createdBy")
      .lean();

    if (ticket) {
      return res.status(200).json({
        success: true,
        data: { ticket, ticketType: "ticket-type" },
      });
    }

    ticket = await UserEventTicket.findById(id)
      .select("ticketName ticketNumber status owner eventSnapshot ticketSnapshot checkIn redeemedAt createdAt")
      .populate("owner", "firstName surname email phoneNumber profilePicture")
      .lean();

    if (ticket) {
      return res.status(200).json({
        success: true,
        data: { ticket, ticketType: "issued-ticket" },
      });
    }

    return res.status(404).json({ success: false, message: "Ticket not found" });
  } catch (error) {
    console.error("[ADMIN GET TICKET DETAIL ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching ticket detail" });
  }
};

module.exports = {
  getTickets,
  getTicketDetail,
};
