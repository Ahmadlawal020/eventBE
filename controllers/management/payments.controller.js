const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const mongoose = require("mongoose");
const { getPaymentGateway } = require("../../services/payment");

const {
  paymentLedger,
} = require("../../services/management/paymentLedger.service");
const getPayments = async (req, res) => {
  try {
    const { reference, status, type = "all" } = req.query;
    if (!["all", "event", "event-center"].includes(type))
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment type" });
    if (
      status &&
      !["PENDING", "COMPLETED", "FAILED", "REFUNDED", "FAILED_REFUND"].includes(
        status,
      )
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment status" });
    if (reference !== undefined && typeof reference !== "string")
      return res
        .status(400)
        .json({ success: false, message: "Reference must be text" });
    const positiveInteger = (value, fallback, maximum) =>
      Number.isSafeInteger(Number(value)) && Number(value) > 0
        ? Math.min(Number(value), maximum)
        : fallback;
    const page = positiveInteger(req.query.page, 1, 1000000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const query = {};
    if (reference?.trim())
      query.paymentReference = new RegExp(
        reference
          .trim()
          .slice(0, 200)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    if (status) query.paymentStatus = status;
    const data = await paymentLedger({ query, type, page, limit });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[ADMIN GET PAYMENTS ERROR]", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error fetching payments" });
  }
};

const verifyPaymentReference = async (req, res) => {
  try {
    const { reference } = req.params;
    const data = await getPaymentGateway().verifyPayment(reference);

    res.status(200).json({
      success: true,
      message: "Payment reference verified",
      data,
    });
  } catch (error) {
    console.error("[ADMIN VERIFY PAYMENT ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Could not verify payment reference" });
  }
};

// @desc Get single payment detail
// @route GET /api/admin/payments/:id
const getPaymentDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment ID" });
    }

    let payment = await EventBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate({
        path: "eventId",
        select: "title status images location createdBy",
        populate: { path: "createdBy", select: "firstName surname email" },
      })
      .lean();

    if (payment) {
      return res.status(200).json({
        success: true,
        data: { payment: { ...payment, paymentType: "event" } },
      });
    }

    payment = await EventCenterBooking.findById(id)
      .select("-qrPayload")
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("organiser", "firstName surname email")
      .populate({
        path: "eventCenter",
        select: "venueName status images location createdBy",
        populate: { path: "createdBy", select: "firstName surname email" },
      })
      .lean();

    if (payment) {
      return res.status(200).json({
        success: true,
        data: { payment: { ...payment, paymentType: "event-center" } },
      });
    }

    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  } catch (error) {
    console.error("[ADMIN GET PAYMENT DETAIL ERROR]", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error fetching payment detail",
      });
  }
};

module.exports = {
  getPayments,
  getPaymentDetail,
  verifyPaymentReference,
};
