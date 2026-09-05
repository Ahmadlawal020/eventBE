const TicketTransferRequest = require("../../models/client/ticketTransferRequest.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");

const getTransfers = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query = {};

    if (status && status !== "all") query.status = status;

    let transfers = await TicketTransferRequest.find(query)
      .populate("sender", "firstName surname email profilePicture")
      .populate("recipient", "firstName surname email profilePicture")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await TicketTransferRequest.countDocuments(query);

    // Enrich with ticket details
    transfers = await Promise.all(
      transfers.map(async (transfer) => {
        let ticketDetails = null;
        if (transfer.ticketCategory === "USER_EVENT") {
          ticketDetails = await UserEventTicket.findById(transfer.ticketId)
            .select("ticketName ticketNumber status eventId ticketSnapshot")
            .populate("eventId", "title")
            .lean();
        } else {
          ticketDetails = await EventCenterBooking.findById(transfer.ticketId)
            .select("ticketNumber status eventCenter totalPrice")
            .populate("eventCenter", "venueName")
            .lean();
        }
        return { ...transfer, ticketDetails };
      })
    );

    // Apply search filter after enrichment (search by sender/recipient email or name)
    if (search) {
      const searchLower = search.toLowerCase();
      transfers = transfers.filter((t) => {
        const senderMatch =
          t.sender?.email?.toLowerCase().includes(searchLower) ||
          t.sender?.firstName?.toLowerCase().includes(searchLower) ||
          t.sender?.surname?.toLowerCase().includes(searchLower);
        const recipientMatch =
          t.recipient?.email?.toLowerCase().includes(searchLower) ||
          t.recipient?.firstName?.toLowerCase().includes(searchLower) ||
          t.recipient?.surname?.toLowerCase().includes(searchLower);
        return senderMatch || recipientMatch;
      });
    }

    res.status(200).json({
      success: true,
      data: {
        transfers,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET TRANSFERS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching transfers" });
  }
};

const getTransferDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const transfer = await TicketTransferRequest.findById(id)
      .populate("sender", "firstName surname email phoneNumber profilePicture createdAt")
      .populate("recipient", "firstName surname email phoneNumber profilePicture createdAt")
      .lean();

    if (!transfer) {
      return res.status(404).json({ success: false, message: "Transfer not found" });
    }

    let ticketDetails = null;
    if (transfer.ticketCategory === "USER_EVENT") {
      ticketDetails = await UserEventTicket.findById(transfer.ticketId)
        .populate("eventId", "title status images schedule location")
        .populate("owner", "firstName surname email")
        .lean();
    } else {
      ticketDetails = await EventCenterBooking.findById(transfer.ticketId)
        .populate("eventCenter", "venueName status images location")
        .populate("buyer", "firstName surname email")
        .lean();
    }

    res.status(200).json({
      success: true,
      data: {
        transfer: { ...transfer, ticketDetails },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET TRANSFER DETAIL ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching transfer detail" });
  }
};

module.exports = {
  getTransfers,
  getTransferDetail,
};
