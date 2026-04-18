const UserEventTicket = require("../../models/user/userEventTicket.schema");
const Ticket = require("../../models/user/eventTicket.schema");
const Event = require("../../models/user/event.schema");
const crypto = require("crypto");

/**
 * Helper to generate a unique ticket number
 */
const generateTicketNumber = () => {
  return "MNB-" + crypto.randomBytes(4).toString("hex").toUpperCase();
};

/**
 * GET MY TICKETS
 */
const getMyTickets = async (req, res) => {
  const userId = req.user.id;

  try {
    const tickets = await UserEventTicket.find({ owner: userId })
      .populate("eventId", "title coverImage startDateTime endDateTime venue")
      .populate("ticketTypeId", "name price")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    console.error("[GET MY TICKETS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching tickets" });
  }
};

/**
 * GET TICKET DETAILS
 */
const getTicketDetails = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const ticket = await UserEventTicket.findOne({ _id: id, owner: userId })
      .populate("eventId")
      .populate("ticketTypeId")
      .populate("bookingId");

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    console.error("[GET TICKET DETAILS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching ticket details" });
  }
};

/**
 * TRIGGER: CREATE TICKETS FOR BOOKING
 * This is called from the booking controller after successful payment
 */
const createTicketsForBooking = async (booking) => {
  try {
    const userEventTickets = [];

    // 1. Fetch Event for Snapshot
    const event = await Event.findById(booking.eventId).populate("createdBy", "firstName surname email phoneNumber");
    if (!event) throw new Error("Event not found for snapshotting");

    const eventSnapshot = {
      title: event.title,
      shortDescription: event.shortDescription,
      coverImage: event.images?.[0]?.url || "",
      eventType: event.eventType,
      organiser: {
        name: `${event.createdBy?.firstName || ""} ${event.createdBy?.surname || ""}`.trim() || "Munasaba Organiser",
        email: event.createdBy?.email || "",
        phoneNumber: event.createdBy?.phoneNumber || "",
      },
      location: {
        addressString: event.location?.addressString || "",
        city: event.location?.city || "",
        state: event.location?.state || "",
        country: event.location?.country || "",
        coordinates: {
          latitude: event.location?.coordinates?.latitude,
          longitude: event.location?.coordinates?.longitude,
        },
      },
      schedule: {
        startDate: event.schedule?.from,
        endDate: event.schedule?.to,
      },
      arrivalGuide: {
        notes: event.arrivalGuide?.notes,
        parking: event.arrivalGuide?.parking,
        checkInInstructions: event.arrivalGuide?.checkInInstructions,
      },
    };

    for (const item of booking.items) {
      // 2. Fetch Ticket Type for Snapshot
      const ticketType = await Ticket.findById(item.ticketId);
      if (!ticketType) continue;

      // Update Inventory
      await Ticket.findByIdAndUpdate(item.ticketId, {
        $inc: { soldQuantity: item.quantity }
      });

      const ticketSnapshot = {
        name: ticketType.name,
        description: ticketType.description,
        additionalInstruction: ticketType.additionalInstruction,
        ticketType: ticketType.ticketType,
        price: {
          amount: (ticketType.price?.amountCents || 0) / 100,
          currency: ticketType.currency?.code || "NGN",
          symbol: ticketType.currency?.symbol || "₦",
        },
      };

      // Create N individual tickets based on quantity
      for (let i = 0; i < item.quantity; i++) {
        userEventTickets.push({
          bookingId: booking._id,
          eventId: booking.eventId,
          ticketTypeId: item.ticketId,
          owner: booking.buyer,
          ticketName: item.name,
          ticketNumber: generateTicketNumber(),
          status: "UNREDEEMED",
          eventSnapshot,
          ticketSnapshot,
        });
      }
    }

    if (userEventTickets.length > 0) {
      const savedTickets = await UserEventTicket.insertMany(userEventTickets);
      return savedTickets;
    }

    return [];
  } catch (error) {
    console.error("[CREATE TICKETS FOR BOOKING ERROR]", error);
    throw error;
  }
};

module.exports = {
  getMyTickets,
  getTicketDetails,
  createTicketsForBooking,
};
