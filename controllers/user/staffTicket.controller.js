const Event = require("../../models/user/event.schema");
const Ticket = require("../../models/user/eventTicket.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const mongoose = require("mongoose");

/**
 * Helper: Verify staff has access to the given event
 */
const verifyStaffEventAccess = async (staffId, eventId) => {
  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return { error: "Invalid event ID.", status: 400 };
  }

  const invitation = await StaffInvitation.findOne({
    staff: staffId,
    status: "ACCEPTED",
    "listings.listingId": eventId,
    "listings.listingType": "Event",
  }).lean();

  if (!invitation) {
    return { error: "You do not have staff access to this event.", status: 403 };
  }

  return { invitation };
};

/**
 * @desc    Get ticket stats for a staff-assigned event
 * @route   GET /api/staff/tickets/stats/:eventId
 * @access  Private (Staff)
 */
exports.getStaffTicketStats = async (req, res) => {
  try {
    const { eventId } = req.params;
    const staffId = req.user.id;

    const access = await verifyStaffEventAccess(staffId, eventId);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    const event = await Event.findById(eventId)
      .select("_id title status images schedule")
      .lean();

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found." });
    }

    // Inventory stats
    const inventoryStats = await Ticket.aggregate([
      { $match: { eventId: event._id } },
      {
        $group: {
          _id: null,
          totalCapacity: { $sum: "$totalQuantity" },
          totalSold: { $sum: "$soldQuantity" },
        },
      },
    ]);

    const inv = inventoryStats[0] || { totalCapacity: 0, totalSold: 0 };

    // Ticket status stats
    const now = new Date();
    const ticketStats = await UserEventTicket.aggregate([
      { $match: { eventId: event._id } },
      {
        $group: {
          _id: null,
          totalTickets: { $sum: 1 },
          checkedIn: { $sum: { $cond: [{ $eq: ["$status", "REDEEMED"] }, 1, 0] } },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "UNREDEEMED"] }, 1, 0] },
          },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
        },
      },
    ]);

    const tStats = ticketStats[0] || { totalTickets: 0, checkedIn: 0, pending: 0, cancelled: 0 };

    // Today's check-in stats
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const todayCheckIns = await UserEventTicket.countDocuments({
      eventId: event._id,
      status: "REDEEMED",
      redeemedAt: { $gte: startOfDay, $lte: endOfDay },
    });

    const turnOutRate =
      tStats.totalTickets > 0
        ? ((tStats.checkedIn / tStats.totalTickets) * 100).toFixed(1) + "%"
        : "0%";

    res.status(200).json({
      success: true,
      data: {
        event: {
          id: event._id,
          title: event.title,
          status: event.status,
          image: event.images?.[0]?.url || "",
        },
        totalCapacity: inv.totalCapacity,
        totalSold: inv.totalSold,
        remainingTickets: Math.max(0, inv.totalCapacity - inv.totalSold),
        totalCheckedIn: tStats.checkedIn,
        totalPending: tStats.pending,
        totalCancelled: tStats.cancelled,
        todayCheckIns,
        turnOutRate,
      },
    });
  } catch (error) {
    console.error("[STAFF GET TICKET STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * @desc    Get all tickets (attendees) for a staff-assigned event
 * @route   GET /api/staff/tickets/:eventId
 * @access  Private (Staff)
 */
exports.getStaffEventTickets = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, tier, page = 1, limit = 20 } = req.query;
    const staffId = req.user.id;

    const access = await verifyStaffEventAccess(staffId, eventId);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    const query = { eventId: new mongoose.Types.ObjectId(eventId) };

    if (status === "SCANNED" || status === "REDEEMED") {
      query.status = "REDEEMED";
    } else if (status === "BOUGHT" || status === "UNREDEEMED") {
      query.status = { $in: ["UNREDEEMED", "REDEEMED"] };
    } else if (status === "CANCELLED") {
      query.status = "CANCELLED";
    }

    if (tier && tier !== "All") {
      query.ticketName = tier;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const tickets = await UserEventTicket.find(query)
      .populate("owner", "firstName lastName email profileImage phoneNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await UserEventTicket.countDocuments(query);

    res.status(200).json({
      success: true,
      data: tickets,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[STAFF GET EVENT TICKETS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * @desc    Get details of a specific ticket
 * @route   GET /api/staff/tickets/details/:ticketId
 * @access  Private (Staff)
 */
exports.getStaffTicketDetails = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const staffId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ success: false, message: "Invalid ticket ID." });
    }

    const ticket = await UserEventTicket.findById(ticketId)
      .populate("owner", "firstName lastName email profileImage phoneNumber")
      .populate("eventId", "title status images schedule");

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found." });
    }

    // Verify staff has access to this event
    const access = await verifyStaffEventAccess(staffId, ticket.eventId._id || ticket.eventId);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    console.error("[STAFF GET TICKET DETAILS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * @desc    Search tickets by ticket number, name, or email
 * @route   GET /api/staff/tickets/search/:eventId
 * @access  Private (Staff)
 */
exports.searchStaffTickets = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { query: searchQuery } = req.query;
    const staffId = req.user.id;

    if (!searchQuery) {
      return res.status(400).json({ success: false, message: "Search query is required." });
    }

    const access = await verifyStaffEventAccess(staffId, eventId);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    // Search by ticket number first
    let tickets = await UserEventTicket.find({
      eventId: new mongoose.Types.ObjectId(eventId),
      ticketNumber: { $regex: searchQuery, $options: "i" },
    }).populate("owner", "firstName lastName email profileImage phoneNumber");

    // If not found, search by owner details (using populated field won't work, use aggregate)
    if (tickets.length === 0) {
      tickets = await UserEventTicket.aggregate([
        { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
        {
          $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "owner",
          },
        },
        { $unwind: "$owner" },
        {
          $match: {
            $or: [
              { "owner.firstName": { $regex: searchQuery, $options: "i" } },
              { "owner.lastName": { $regex: searchQuery, $options: "i" } },
              { "owner.email": { $regex: searchQuery, $options: "i" } },
            ],
          },
        },
        {
          $project: {
            ticketNumber: 1,
            ticketName: 1,
            status: 1,
            redeemedAt: 1,
            checkIn: 1,
            createdAt: 1,
            eventSnapshot: 1,
            ticketSnapshot: 1,
            "owner._id": 1,
            "owner.firstName": 1,
            "owner.lastName": 1,
            "owner.email": 1,
            "owner.profileImage": 1,
            "owner.phoneNumber": 1,
          },
        },
      ]);
    }

    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    console.error("[STAFF SEARCH TICKETS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * @desc    Staff manual check-in for an event ticket
 * @route   POST /api/staff/tickets/:ticketId/check-in
 * @access  Private (Staff)
 */
exports.staffTicketCheckIn = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const staffId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ success: false, message: "Invalid ticket ID." });
    }

    const ticket = await UserEventTicket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found." });
    }

    // Verify staff access
    const access = await verifyStaffEventAccess(staffId, ticket.eventId);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    if (ticket.status === "CANCELLED") {
      return res.status(400).json({ success: false, message: "Cannot check in a cancelled ticket." });
    }

    if (ticket.status === "REDEEMED") {
      return res.status(400).json({ success: false, message: "Ticket is already checked in." });
    }

    ticket.status = "REDEEMED";
    ticket.redeemedAt = new Date();
    ticket.redeemedBy = staffId;
    ticket.checkIn = {
      isCheckedIn: true,
      checkedInAt: new Date(),
      checkedInBy: staffId,
      method: "MANUAL",
    };

    await ticket.save();

    res.status(200).json({
      success: true,
      message: "Guest successfully checked in.",
      data: ticket,
    });
  } catch (error) {
    console.error("[STAFF TICKET CHECK-IN ERROR]", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * @desc    Staff cancel a ticket
 * @route   POST /api/staff/tickets/:ticketId/cancel
 * @access  Private (Staff)
 */
exports.staffCancelTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const staffId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ success: false, message: "Invalid ticket ID." });
    }

    const ticket = await UserEventTicket.findById(ticketId);

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found." });
    }

    // Verify staff access
    const access = await verifyStaffEventAccess(staffId, ticket.eventId);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    if (ticket.status === "CANCELLED") {
      return res.status(400).json({ success: false, message: "Ticket is already cancelled." });
    }

    if (ticket.status === "REDEEMED") {
      return res.status(400).json({ success: false, message: "Cannot cancel a ticket that has been checked in." });
    }

    ticket.status = "CANCELLED";
    await ticket.save();

    res.status(200).json({
      success: true,
      message: "Ticket successfully cancelled.",
      data: ticket,
    });
  } catch (error) {
    console.error("[STAFF CANCEL TICKET ERROR]", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * @desc    Get ticket tier distribution for a staff-assigned event
 * @route   GET /api/staff/tickets/tiers/:eventId
 * @access  Private (Staff)
 */
exports.getStaffTicketTiers = async (req, res) => {
  try {
    const { eventId } = req.params;
    const staffId = req.user.id;

    const access = await verifyStaffEventAccess(staffId, eventId);
    if (access.error) {
      return res.status(access.status).json({ success: false, message: access.error });
    }

    const tiers = await Ticket.find({ eventId: new mongoose.Types.ObjectId(eventId) })
      .select("name totalQuantity soldQuantity ticketType price")
      .lean();

    // Get redemption per tier
    const redemptionPerTier = await UserEventTicket.aggregate([
      { $match: { eventId: new mongoose.Types.ObjectId(eventId) } },
      {
        $group: {
          _id: "$ticketTypeId",
          redeemed: { $sum: { $cond: [{ $eq: ["$status", "REDEEMED"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
        },
      },
    ]);

    const redemptionMap = {};
    redemptionPerTier.forEach((r) => {
      redemptionMap[r._id.toString()] = r;
    });

    const distribution = tiers.map((t) => {
      const red = redemptionMap[t._id.toString()] || { redeemed: 0, cancelled: 0 };
      return {
        id: t._id,
        tier: t.name,
        sold: t.soldQuantity,
        total: t.totalQuantity,
        type: t.ticketType,
        redeemed: red.redeemed,
        cancelled: red.cancelled,
      };
    });

    res.status(200).json({
      success: true,
      data: distribution,
    });
  } catch (error) {
    console.error("[STAFF GET TICKET TIERS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
