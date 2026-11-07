const mongoose = require("mongoose");
const Booking = require("../../models/client/eventCenterBooking.schema");
const Venue = require("../../models/client/eventCenter.schema");
const Refund = require("../../models/client/eventCenterRefund.schema");
const filters = {
  ALL: {}, ACTIVE: { status: { $in: ["ACTIVE", "CONFIRMED", "PENDING_REVIEW"] } },
  CANCELLED: { status: "CANCELLED" },
  DUE: { "directRefund.status": { $in: ["AWAITING_BUYER_DETAILS", "DUE_FROM_ORGANISER", "OVERDUE"] }, "directRefund.markedPaidAt": null },
  SENT: { "directRefund.markedPaidAt": { $ne: null }, "directRefund.status": { $ne: "CONFIRMED_BY_BUYER" } },
  REFUNDED: { "directRefund.status": "CONFIRMED_BY_BUYER" },
  ATTENTION: { $or: [{ "directRefund.status": { $in: ["DISPUTED", "OVERDUE"] } }, { "directRefund.supportRequest.status": "OPEN" }] },
};
exports.list = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid venue ID." });
    const venue = await Venue.findOne({ _id: req.params.id, createdBy: req.user.id }).select("venueName availability basePrice images location createdAt updatedAt").lean();
    if (!venue) return res.status(404).json({ message: "Venue not found." });
    const filter = req.query.filter || "ALL";
    if (typeof filter !== "string" || !Object.hasOwn(filters, filter)) return res.status(400).json({ message: "Invalid ticket filter." });
    if (req.query.search !== undefined && (typeof req.query.search !== "string" || req.query.search.length > 100)) return res.status(400).json({ message: "Search must be at most 100 characters." });
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50)
      return res.status(400).json({ message: "Invalid page or page size." });
    const search = (req.query.search || "").trim();
    const match = { eventCenter: venue._id, organiser: new mongoose.Types.ObjectId(req.user.id) };
    if (search) {
      const literal = new RegExp(search.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [{ ticketNumber: literal }, { "guestDetails.fullName": literal }, { "guestDetails.email": literal }];
    }
    const [result] = await Booking.aggregate([
      { $match: match },
      { $lookup: { from: Refund.collection.name, localField: "_id", foreignField: "ticketId",
        pipeline: [{ $match: { organiser: new mongoose.Types.ObjectId(req.user.id) } },
          { $project: { _id: 1, status: 1, amountMinor: 1, currency: 1, dueAt: 1, markedPaidAt: 1, "supportRequest.status": 1 } }],
        as: "directRefund" } },
      { $set: { directRefund: { $arrayElemAt: ["$directRefund", 0] } } },
      { $facet: {
        rows: [{ $match: filters[filter] }, { $sort: { updatedAt: -1, _id: -1 } }, { $limit: page * limit },
          { $project: { _id: 1, ticketNumber: 1, guestDetails: 1, selectedDates: 1, bookingUnit: 1, status: 1, paymentStatus: 1,
            totalPrice: 1, subtotalPrice: 1, cancellation: 1, directRefund: 1, "refund.state": 1 } }],
        count: [{ $match: filters[filter] }, { $count: "total" }],
        summary: [{ $group: { _id: null, bookings: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
          refunds: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$directRefund._id", null] }, null] }, 1, 0] } },
          confirmed: { $sum: { $cond: [{ $eq: ["$directRefund.status", "CONFIRMED_BY_BUYER"] }, 1, 0] } },
        } }],
      } },
    ]);
    const manual = (await require("../../services/manualBookingRead.service").getManualBookings([venue]))
      .filter(b => !search || [b.guestName, b.guestEmail, b.bookingId].some(v => String(v || "").toLowerCase().includes(search.toLowerCase())));
    const isManualMatch = b => filter === "ALL" || filter === "ACTIVE" && ["ACTIVE", "CONFIRMED", "PENDING_REVIEW"].includes(b.status) ||
      filter === "CANCELLED" && b.status === "CANCELLED" ||
      filter === "DUE" && b.status === "CANCELLED" && b.manualFinance.netCollectedMinor > 0 ||
      filter === "REFUNDED" && b.manualFinance.refundedMinor > 0 && b.manualFinance.netCollectedMinor === 0 ||
      filter === "ATTENTION" && b.status === "CANCELLED" && b.manualFinance.netCollectedMinor > 0;
    const selectedManual = manual.filter(isManualMatch);
    const summary = result.summary[0] || { bookings: 0, cancelled: 0, refunds: 0, confirmed: 0 };
    summary.bookings += manual.length;
    summary.cancelled += manual.filter(b => b.status === "CANCELLED").length;
    summary.confirmed += manual.filter(b => b.manualFinance.refundedMinor > 0 && b.manualFinance.netCollectedMinor === 0).length;
    const total = (result.count[0]?.total || 0) + selectedManual.length;
    const rows = [...result.rows.map(b => ({ ...b, bookingType: "PLATFORM" })), ...selectedManual]
      .sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0) || String(b._id).localeCompare(String(a._id)))
      .slice((page - 1) * limit, page * limit);
    res.json({ success: true, data: { venue: { _id: venue._id, venueName: venue.venueName }, rows, summary,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) } } });
  } catch (error) { console.error("[VENUE REFUND WORKSPACE]", error); res.status(500).json({ message: "Could not load venue tickets and refunds." }); }
};
exports.details = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
    const booking = await Booking.findOne({ _id: req.params.id, organiser: req.user.id })
      .select("ticketNumber guestDetails selectedDates bookingUnit status paymentStatus totalPrice subtotalPrice cancellation cancellationPolicy checkIn paymentResolutionRequired refund bookingMode reviewDeadline eventCenter")
      .populate("eventCenter", "venueName").lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    const preview = booking.status === "CANCELLED" ? null : await require("../../services/venueCancellation.service").preview(booking);
    res.json({ success: true, data: { booking, preview } });
  } catch { res.status(500).json({ message: "Could not load booking." }); }
};
