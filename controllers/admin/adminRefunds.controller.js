const EventBooking = require("../../models/user/eventBooking.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const { getPaymentGateway } = require("../../services/payment");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

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
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = { paymentStatus: "REFUNDED" };

    const [eventRefunds, venueRefunds, eventCount, venueCount] = await Promise.all([
      EventBooking.find(query)
        .populate("buyer", "firstName surname email")
        .populate("eventId", "title")
        .select("buyer eventId totalAmount currency paymentStatus paymentReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EventCenterBooking.find(query)
        .populate("buyer", "firstName surname email")
        .populate("organiser", "firstName surname email")
        .populate("eventCenter", "venueName")
        .select("buyer organiser eventCenter totalPrice paymentStatus paymentReference createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      EventBooking.countDocuments(query),
      EventCenterBooking.countDocuments(query),
    ]);

    const refunds = [
      ...eventRefunds.map((r) => ({ ...r, bookingType: "event" })),
      ...venueRefunds.map((r) => ({ ...r, bookingType: "event-center" })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      data: {
        refunds: refunds.slice(0, Number(limit)),
        pagination: {
          total: eventCount + venueCount,
          page: Number(page),
          pages: Math.ceil((eventCount + venueCount) / Number(limit)),
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

    let refund = await EventBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("eventId", "title status images location createdBy", { populate: { path: "createdBy", select: "firstName surname email" } })
      .lean();

    if (refund && refund.paymentStatus === "REFUNDED") {
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
