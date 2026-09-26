const {
  paymentLedger,
} = require("../../services/management/paymentLedger.service");
const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const mongoose = require("mongoose");
const getRefunds = async (req, res) => {
  try {
    const { search, type = "all", page = 1, limit = 20 } = req.query;
    if (
      !["all", "event", "event-center"].includes(type) ||
      (search !== undefined && typeof search !== "string")
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid refund filters" });
    }
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNumber = Math.min(
      100,
      Math.max(1, Number.parseInt(limit, 10) || 20),
    );
    const query = { paymentStatus: { $in: ["REFUNDED", "FAILED_REFUND"] } };
    if (search) {
      query.paymentReference = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }
    const result = await paymentLedger({
      query,
      type,
      page: pageNumber,
      limit: limitNumber,
    });
    return res.status(200).json({
      success: true,
      data: {
        refunds: result.payments.map(({ paymentType, ...booking }) => ({
          ...booking,
          bookingType: paymentType,
        })),
        metrics: {
          refunded: result.metrics.refunded,
          failed: result.metrics.failedRefunds,
          volume: result.metrics.refundedVolume,
          currencies: result.metrics.currencies.map(
            ({ currency, refundedVolume }) => ({
              currency,
              volume: refundedVolume,
            }),
          ),
        },
        pagination: result.pagination,
      },
    });
  } catch (error) {
    console.error("[ADMIN GET REFUNDS ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching refunds" });
  }
};

const getRefundDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid refund ID" });
    }

    let refund = await EventBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate({
        path: "eventId",
        select: "title status images location createdBy",
        populate: { path: "createdBy", select: "firstName surname email" },
      })
      .lean();

    if (
      refund &&
      ["REFUNDED", "FAILED_REFUND"].includes(refund.paymentStatus)
    ) {
      return res.status(200).json({
        success: true,
        data: { refund: { ...refund, bookingType: "event" } },
      });
    }

    refund = await EventCenterBooking.findById(id)
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("organiser", "firstName surname email")
      .populate({
        path: "eventCenter",
        select: "venueName status images location createdBy",
        populate: { path: "createdBy", select: "firstName surname email" },
      })
      .select("-qrPayload")
      .lean();

    if (
      refund &&
      ["REFUNDED", "FAILED_REFUND"].includes(refund.paymentStatus)
    ) {
      return res.status(200).json({
        success: true,
        data: { refund: { ...refund, bookingType: "event-center" } },
      });
    }

    return res
      .status(404)
      .json({ success: false, message: "Refund not found" });
  } catch (error) {
    console.error("[ADMIN GET REFUND DETAIL ERROR]", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching refund detail" });
  }
};

module.exports = {
  getRefunds,
  getRefundDetail,
};
