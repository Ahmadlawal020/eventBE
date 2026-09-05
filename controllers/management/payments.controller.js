const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const mongoose = require("mongoose");
const { getPaymentGateway } = require("../../services/payment");

const gateway = getPaymentGateway();

const getPayments = async (req, res) => {
  try {
    const { reference, status, type = "all", page = 1, limit = 20 } = req.query;
    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNumber - 1) * limitNumber;
    const query = {};

    if (reference) query.paymentReference = new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (status) query.paymentStatus = status;

    const includeEvents = type === "all" || type === "event";
    const includeVenues = type === "all" || type === "event-center";
    const emptyQuery = {
      lean: async () => [],
    };
    const eventPaymentQuery = includeEvents
      ? EventBooking.find(query)
        .populate("buyer", "firstName surname email")
        .populate("eventId", "title")
        .select("buyer eventId totalAmount currency paymentStatus paymentMethod paymentReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
      : emptyQuery;
    const venuePaymentQuery = includeVenues
      ? EventCenterBooking.find(query)
        .populate("buyer", "firstName surname email")
        .populate("organiser", "firstName surname email")
        .populate("eventCenter", "venueName")
        .select("buyer organiser eventCenter totalPrice paymentStatus paymentReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
      : emptyQuery;

    const [
      eventPayments,
      venuePayments,
      eventCount,
      venueCount,
      eventMetrics,
      venueMetrics,
    ] = await Promise.all([
      eventPaymentQuery.lean(),
      venuePaymentQuery.lean(),
      includeEvents ? EventBooking.countDocuments(query) : 0,
      includeVenues ? EventCenterBooking.countDocuments(query) : 0,
      EventBooking.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PENDING"] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$paymentStatus", "FAILED"] }, 1, 0] } },
            refunded: { $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, 1, 0] } },
            grossProcessed: { $sum: { $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, { $divide: ["$totalAmount", 100] }, 0] } },
            refundedVolume: { $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, { $divide: ["$totalAmount", 100] }, 0] } },
          },
        },
      ]),
      EventCenterBooking.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PENDING"] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$paymentStatus", "FAILED"] }, 1, 0] } },
            refunded: { $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, 1, 0] } },
            grossProcessed: { $sum: { $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, { $ifNull: ["$totalPrice.amount", 0] }, 0] } },
            refundedVolume: { $sum: { $cond: [{ $eq: ["$paymentStatus", "REFUNDED"] }, { $ifNull: ["$totalPrice.amount", 0] }, 0] } },
          },
        },
      ]),
    ]);

    const payments = [
      ...eventPayments.map((payment) => ({ ...payment, paymentType: "event" })),
      ...venuePayments.map((payment) => ({ ...payment, paymentType: "event-center" })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      data: {
        payments: payments.slice(0, limitNumber),
        metrics: mergePaymentMetrics(eventMetrics[0], venueMetrics[0]),
        pagination: {
          total: eventCount + venueCount,
          page: pageNumber,
          pages: Math.ceil((eventCount + venueCount) / limitNumber),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET PAYMENTS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching payments" });
  }
};

const verifyPaymentReference = async (req, res) => {
  try {
    const { reference } = req.params;
    const data = await gateway.verifyPayment(reference);

    res.status(200).json({
      success: true,
      message: "Payment reference verified",
      data,
    });
  } catch (error) {
    console.error("[ADMIN VERIFY PAYMENT ERROR]", error);
    res.status(500).json({ success: false, message: "Could not verify payment reference" });
  }
};

// @desc Get single payment detail
// @route GET /api/admin/payments/:id
const getPaymentDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid payment ID" });
    }

    let payment = await EventBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("eventId", "title status images location createdBy", { populate: { path: "createdBy", select: "firstName surname email" } })
      .lean();

    if (payment) {
      return res.status(200).json({
        success: true,
        data: { payment: { ...payment, paymentType: "event" } },
      });
    }

    payment = await EventCenterBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("organiser", "firstName surname email")
      .populate("eventCenter", "venueName status images location createdBy", { populate: { path: "createdBy", select: "firstName surname email" } })
      .lean();

    if (payment) {
      return res.status(200).json({
        success: true,
        data: { payment: { ...payment, paymentType: "event-center" } },
      });
    }

    return res.status(404).json({ success: false, message: "Payment not found" });
  } catch (error) {
    console.error("[ADMIN GET PAYMENT DETAIL ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching payment detail" });
  }
};

const mergePaymentMetrics = (eventMetrics = {}, venueMetrics = {}) => ({
  total: (eventMetrics.total || 0) + (venueMetrics.total || 0),
  completed: (eventMetrics.completed || 0) + (venueMetrics.completed || 0),
  pending: (eventMetrics.pending || 0) + (venueMetrics.pending || 0),
  failed: (eventMetrics.failed || 0) + (venueMetrics.failed || 0),
  refunded: (eventMetrics.refunded || 0) + (venueMetrics.refunded || 0),
  grossProcessed:
    (eventMetrics.grossProcessed || 0) + (venueMetrics.grossProcessed || 0),
  refundedVolume:
    (eventMetrics.refundedVolume || 0) + (venueMetrics.refundedVolume || 0),
});

module.exports = {
  getPayments,
  getPaymentDetail,
  verifyPaymentReference,
};
