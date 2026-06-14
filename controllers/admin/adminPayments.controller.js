const EventBooking = require("../../models/user/eventBooking.schema");
const EventCenterTicket = require("../../models/user/eventCenterTicket.schema");
const paystackService = require("../../services/paystack.service");

const getPayments = async (req, res) => {
  try {
    const { reference, status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query = {};

    if (reference) query.paystackReference = new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (status) query.paymentStatus = status;

    const [eventPayments, venuePayments, eventCount, venueCount] = await Promise.all([
      EventBooking.find(query)
        .populate("buyer", "firstName surname email")
        .populate("eventId", "title")
        .select("buyer eventId totalAmount currency paymentStatus paymentMethod paystackReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EventCenterTicket.find(query)
        .populate("buyer", "firstName surname email")
        .populate("organiser", "firstName surname email")
        .populate("eventCenter", "venueName")
        .select("buyer organiser eventCenter totalPrice paymentStatus paystackReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EventBooking.countDocuments(query),
      EventCenterTicket.countDocuments(query),
    ]);

    const payments = [
      ...eventPayments.map((payment) => ({ ...payment, paymentType: "event" })),
      ...venuePayments.map((payment) => ({ ...payment, paymentType: "event-center" })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      data: {
        payments: payments.slice(0, Number(limit)),
        pagination: {
          total: eventCount + venueCount,
          page: Number(page),
          pages: Math.ceil((eventCount + venueCount) / Number(limit)),
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
    const data = await paystackService.verifyTransaction(reference);

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

    payment = await EventCenterTicket.findById(id)
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

module.exports = {
  getPayments,
  getPaymentDetail,
  verifyPaymentReference,
};
