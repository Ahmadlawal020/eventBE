const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");

/**
 * GET ALL TICKETS (Aggregated)
 * Fetches both event center bookings and individual event tickets
 */
const getAllMyTickets = async (req, res) => {
  const userId = req.user.id;

  try {
    // 1. Fetch Event Center Tickets (Bookings of venues)
    const eventCenterTickets = await EventCenterTicket.find({ buyer: userId })
      .populate("eventCenter", "venueName images location")
      .sort({ createdAt: -1 })
      .lean();

    const formattedEventCenterTickets = eventCenterTickets.map(ticket => ({
      ...ticket,
      ticketCategory: 'EVENT_CENTER',
    }));

    // 2. Fetch User Event Tickets (Individual tickets for events)
    const userEventTickets = await UserEventTicket.find({ owner: userId })
      .populate("eventId", "title coverImage startDateTime endDateTime venue location")
      .populate("ticketTypeId", "name price")
      .sort({ createdAt: -1 })
      .lean();

    const formattedUserEventTickets = userEventTickets.map(ticket => ({
      ...ticket,
      ticketCategory: 'USER_EVENT',
    }));

    // 3. Combine and sort
    const allTickets = [...formattedEventCenterTickets, ...formattedUserEventTickets]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      data: allTickets,
    });
  } catch (error) {
    console.error("[GET ALL TICKETS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error aggregating tickets" });
  }
};

const getTicketDetails = async (req, res) => {
  const ticketId = req.params.id;
  const userId = req.user.id;

  try {
    // Check if it's an Event Center Ticket
    const eventCenterTicket = await EventCenterTicket.findOne({ _id: ticketId, buyer: userId })
      .populate("eventCenter");

    if (eventCenterTicket) {
      return res.status(200).json({
        success: true,
        data: {
          ...eventCenterTicket.toObject(),
          ticketCategory: 'EVENT_CENTER',
        }
      });
    }

    // Check if it's a User Event Ticket
    const userEventTicket = await UserEventTicket.findOne({ _id: ticketId, owner: userId })
      .populate("eventId")
      .populate("ticketTypeId");

    if (userEventTicket) {
      return res.status(200).json({
        success: true,
        data: {
          ...userEventTicket.toObject(),
          ticketCategory: 'USER_EVENT',
        }
      });
    }

    return res.status(404).json({ success: false, message: "Ticket not found" });
  } catch (error) {
    console.error("[GET TICKET DETAILS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching ticket details" });
  }
};

module.exports = {
  getAllMyTickets,
  getTicketDetails,
};
