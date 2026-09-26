const mongoose = require("mongoose");
const TicketTransferRequest = require("../../models/client/ticketTransferRequest.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const User = require("../../models/client/user.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");

const STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "CANCELLED"];
const CATEGORIES = ["USER_EVENT", "EVENT_CENTER"];
const positiveInteger = (value, fallback, max) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};
const personFields = "firstName surname email phoneNumber profilePicture";

// Both endpoints expose the same allowlisted ticket summary, never signed QR payloads.
const enrichTransfer = async (transfer) => {
  let ticketDetails = null;
  if (transfer.ticketCategory === "USER_EVENT") {
    ticketDetails = await UserEventTicket.findById(transfer.ticketId)
      .select(
        "ticketName ticketNumber status eventId eventSnapshot ticketSnapshot",
      )
      .populate("eventId", "title coverImage category")
      .lean();
  } else if (transfer.ticketCategory === "EVENT_CENTER") {
    ticketDetails = await EventCenterBooking.findById(transfer.ticketId)
      .select("ticketNumber status eventCenter totalPrice selectedDates bookingUnit duration")
      .populate("eventCenter", "venueName location images venueType")
      .lean();
  }
  return { ...transfer, ticketDetails };
};

const getTransfers = async (req, res) => {
  try {
    const { status, search, ticketCategory } = req.query;
    if (status && status !== "all" && !STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid transfer status" });
    }
    if (ticketCategory && !CATEGORIES.includes(ticketCategory)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ticket category" });
    }
    if (search !== undefined && typeof search !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "Search must be text" });
    }
    const page = positiveInteger(req.query.page, 1, 1000000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const query = {};
    if (status && status !== "all") query.status = status;
    if (ticketCategory) query.ticketCategory = ticketCategory;
    if (search?.trim()) {
      const text = search.trim().slice(0, 200);
      const expression = new RegExp(
        text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      const [people, events, venues] = await Promise.all([
        User.find({
          $or: [
            { firstName: expression },
            { surname: expression },
            { email: expression },
          ],
        })
          .select("_id")
          .lean(),
        Event.find({ title: expression }).select("_id").lean(),
        EventCenter.find({ venueName: expression }).select("_id").lean(),
      ]);
      const [eventTickets, venueTickets] = await Promise.all([
        UserEventTicket.find({
          $or: [
            { ticketNumber: expression },
            { ticketName: expression },
            { "eventSnapshot.title": expression },
            { eventId: { $in: events.map((item) => item._id) } },
          ],
        })
          .select("_id")
          .lean(),
        EventCenterBooking.find({
          $or: [
            { ticketNumber: expression },
            { eventCenter: { $in: venues.map((item) => item._id) } },
          ],
        })
          .select("_id")
          .lean(),
      ]);
      const peopleIds = people.map((person) => person._id);
      query.$or = [
        { sender: { $in: peopleIds } },
        { recipient: { $in: peopleIds } },
        {
          ticketCategory: "USER_EVENT",
          ticketId: { $in: eventTickets.map((item) => item._id) },
        },
        {
          ticketCategory: "EVENT_CENTER",
          ticketId: { $in: venueTickets.map((item) => item._id) },
        },
      ];
      if (mongoose.isValidObjectId(text))
        query.$or.push({ _id: new mongoose.Types.ObjectId(text) });
    }
    // Apply search before pagination and use the same filter for totals.
    const [records, groups] = await Promise.all([
      TicketTransferRequest.find(query)
        .populate("sender", personFields)
        .populate("recipient", personFields)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TicketTransferRequest.aggregate([
        { $match: query },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const counts = Object.fromEntries(
      groups.map((group) => [group._id, group.count]),
    );
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    const transfers = await Promise.all(records.map(enrichTransfer));
    return res.status(200).json({
      success: true,
      data: {
        transfers,
        metrics: {
          totalTransfers: total,
          pendingAcceptance: counts.PENDING || 0,
          completedTransfers: counts.ACCEPTED || 0,
          declinedOrCancelled: (counts.DECLINED || 0) + (counts.CANCELLED || 0),
        },
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET TRANSFERS ERROR]", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error fetching transfers" });
  }
};

const getTransferDetail = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res
        .status(400)
        .json({ success: false, message: "Invalid transfer ID" });
    const transfer = await TicketTransferRequest.findById(req.params.id)
      .populate("sender", personFields)
      .populate("recipient", personFields)
      .lean();
    if (!transfer)
      return res
        .status(404)
        .json({ success: false, message: "Transfer not found" });
    return res
      .status(200)
      .json({
        success: true,
        data: { transfer: await enrichTransfer(transfer) },
      });
  } catch (error) {
    console.error("[ADMIN GET TRANSFER DETAIL ERROR]", error);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error fetching transfer detail",
      });
  }
};
module.exports = { getTransfers, getTransferDetail };
