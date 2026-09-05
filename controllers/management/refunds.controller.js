const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const mongoose = require("mongoose");
const { getPaymentGateway } = require("../../services/payment");
const { recordAdminAction } = require("../../services/management/adminAudit.service");

const gateway = getPaymentGateway();

const initiateRefund = async (req, res) => {
  try {
    const { bookingType, bookingId, reason } = req.body;

    if (!bookingType || !bookingId) {
      return res.status(400).json({ success: false, message: "bookingType and bookingId are required" });
    }

    const Model = bookingType === "event-center" ? EventCenterBooking : EventBooking;
    const booking = await Model.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    if (booking.paymentStatus === "REFUNDED") {
      return res.status(400).json({ success: false, message: "Booking is already refunded" });
    }

    if (booking.paymentStatus !== "COMPLETED") {
      return res.status(400).json({ success: false, message: "Can only refund completed payments" });
    }

    if (!booking.paymentReference) {
      return res.status(400).json({ success: false, message: "No payment reference found for this booking" });
    }

    const previousValue = { paymentStatus: booking.paymentStatus };

    // Initiate refund via payment gateway
    try {
      await gateway.refundPayment(booking.paymentReference);
    } catch (refundErr) {
      console.error("[ADMIN REFUND] Gateway refund failed:", refundErr.message);
      return res.status(502).json({ success: false, message: "Payment gateway refund failed: " + refundErr.message });
    }

    booking.paymentStatus = "REFUNDED";
    await booking.save();

    await recordAdminAction({
      req,
      action: "REFUND_INITIATED",
      targetType: bookingType === "event-center" ? "EventCenterBooking" : "EventBooking",
      targetId: booking._id,
      previousValue,
      newValue: { paymentStatus: "REFUNDED" },
      metadata: { reason, bookingType, paymentReference: booking.paymentReference },
    });

    res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      data: { bookingId: booking._id, paymentStatus: booking.paymentStatus },
    });
  } catch (error) {
    console.error("[ADMIN INITIATE REFUND ERROR]", error);
    res.status(500).json({ success: false, message: "Server error processing refund" });
  }
};

const getRefunds = async (req, res) => {
  try {
    const { search, type = "all", page = 1, limit = 20 } = req.query;
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNumber - 1) * limitNumber;

    const query = { paymentStatus: { $in: ["REFUNDED", "FAILED_REFUND"] } };
    if (search) {
      query.paymentReference = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }
    const includeEvents = type === "all" || type === "event";
    const includeVenues = type === "all" || type === "event-center";

    const [eventRefunds, venueRefunds, eventCount, venueCount, eventMetrics, venueMetrics] = await Promise.all([
      includeEvents ? EventBooking.find(query)
        .populate("buyer", "firstName surname email")
        .populate("eventId", "title")
        .select("buyer eventId totalAmount currency paymentStatus paymentReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean() : [],
      includeVenues ? EventCenterBooking.find(query)
        .populate("buyer", "firstName surname email")
        .populate("organiser", "firstName surname email")
        .populate("eventCenter", "venueName")
        .select("buyer organiser eventCenter totalPrice paymentStatus paymentReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean() : [],
      includeEvents ? EventBooking.countDocuments(query) : 0,
      includeVenues ? EventCenterBooking.countDocuments(query) : 0,
      EventBooking.aggregate([{ $match: { paymentStatus: "REFUNDED" } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: { $divide: ["$totalAmount", 100] } } } }]),
      EventCenterBooking.aggregate([{ $match: { paymentStatus: { $in: ["REFUNDED", "FAILED_REFUND"] } } }, { $group: { _id: "$paymentStatus", count: { $sum: 1 }, amount: { $sum: { $ifNull: ["$totalPrice.amount", 0] } } } }]),
    ]);

    const refunds = [
      ...eventRefunds.map((r) => ({ ...r, bookingType: "event" })),
      ...venueRefunds.map((r) => ({ ...r, bookingType: "event-center" })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      data: {
        refunds: refunds.slice(0, limitNumber),
        metrics: {
          refunded: (eventMetrics[0]?.count || 0) + (venueMetrics.find((row) => row._id === "REFUNDED")?.count || 0),
          failed: venueMetrics.find((row) => row._id === "FAILED_REFUND")?.count || 0,
          volume: (eventMetrics[0]?.amount || 0) + (venueMetrics.find((row) => row._id === "REFUNDED")?.amount || 0),
        },
        pagination: {
          total: eventCount + venueCount,
          page: pageNumber,
          pages: Math.ceil((eventCount + venueCount) / limitNumber),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET REFUNDS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching refunds" });
  }
};

const getRefundDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid refund ID" });
    }

    let refund = await EventBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("eventId", "title status images location createdBy", { populate: { path: "createdBy", select: "firstName surname email" } })
      .lean();

    if (refund && ["REFUNDED", "FAILED_REFUND"].includes(refund.paymentStatus)) {
      return res.status(200).json({
        success: true,
        data: { refund: { ...refund, bookingType: "event" } },
      });
    }

    refund = await EventCenterBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("organiser", "firstName surname email")
      .populate("eventCenter", "venueName status images location createdBy", { populate: { path: "createdBy", select: "firstName surname email" } })
      .lean();

    if (refund && refund.paymentStatus === "REFUNDED") {
      return res.status(200).json({
        success: true,
        data: { refund: { ...refund, bookingType: "event-center" } },
      });
    }

    return res.status(404).json({ success: false, message: "Refund not found" });
  } catch (error) {
    console.error("[ADMIN GET REFUND DETAIL ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching refund detail" });
  }
};

module.exports = {
  initiateRefund,
  getRefunds,
  getRefundDetail,
};
