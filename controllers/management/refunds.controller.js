const {
  paymentLedger,
} = require("../../services/management/paymentLedger.service");
const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const EventRefund = require("../../models/client/eventRefund.schema");
const mongoose = require("mongoose");
const Staff = require("../../models/management/staff.schema");
const { recordAdminAction } = require("../../services/management/adminAudit.service");
const getRefunds = async (req, res) => {
  try {
    const { search, type = "all", page = 1, limit = 20, support } = req.query;
    if (
      !["all", "event", "event-center", "direct"].includes(type) ||
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
    if (type === "direct") {
      const directQuery = support === "open" ? { "supportRequest.status": "OPEN" } : {};
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        directQuery.$or = [
          { organiserReference: new RegExp(escaped, "i") },
          { status: new RegExp(escaped, "i") },
        ];
      }
      const [refunds, total] = await Promise.all([
        EventRefund.find(directQuery)
          .select("+managementCase")
          .populate("buyer", "firstName surname email phoneNumber")
          .populate("organiser", "firstName surname email")
          .populate("eventId", "title")
          .populate("managementCase.assignedTo", "firstName surname email")
          .sort({ dueAt: 1, createdAt: -1 })
          .skip((pageNumber - 1) * limitNumber)
          .limit(limitNumber)
          .lean(),
        EventRefund.countDocuments(directQuery),
      ]);
      const metrics = await EventRefund.aggregate([
        { $group: {
          _id: "$currency",
          confirmed: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED_BY_BUYER"] }, 1, 0] } },
          attention: { $sum: { $cond: [{ $in: ["$status", ["OVERDUE", "DISPUTED"]] }, 1, 0] } },
          volumeMinor: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED_BY_BUYER"] }, "$amountMinor", 0] } },
        } },
      ]);
      return res.status(200).json({ success: true, data: {
        refunds: refunds.map((refund) => ({
          ...refund,
          bookingType: "event-cancellation",
          paymentStatus: refund.status,
          paymentReference: refund.organiserReference || `DIRECT-${refund._id}`,
          totalAmount: refund.amountMinor,
        })),
        metrics: {
          refunded: metrics.reduce((sum, item) => sum + item.confirmed, 0),
          failed: metrics.reduce((sum, item) => sum + item.attention, 0),
          volume: metrics.reduce((sum, item) => sum + item.volumeMinor, 0),
          currencies: metrics.map((item) => ({ currency: item._id, volume: item.volumeMinor / 100 })),
        },
        pagination: { total, page: pageNumber, limit: limitNumber, pages: Math.ceil(total / limitNumber) },
      }});
    }
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

    refund = await EventRefund.findById(id)
      .select("+managementCase")
      .populate("buyer", "firstName surname email phoneNumber profilePicture")
      .populate("organiser", "firstName surname email")
      .populate("eventId", "title status images location createdBy")
      .populate("managementCase.assignedTo", "firstName surname email")
      .populate("managementCase.notes.author", "firstName surname email")
      .lean();
    if (refund) {
      return res.status(200).json({
        success: true,
        data: { refund: {
          ...refund,
          bookingType: "event-cancellation",
          paymentStatus: refund.status,
          paymentReference: refund.organiserReference || `DIRECT-${refund._id}`,
          totalAmount: refund.amountMinor,
        } },
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

async function loadDirectRefundForAdmin(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return EventRefund.findById(id).select("+managementCase");
}

const assignDirectRefundCase = async (req, res) => {
  try {
    const refund = await loadDirectRefundForAdmin(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: "Direct refund case not found." });
    const assigneeId = req.body?.assigneeId || req.managementStaff?._id || req.user.id;
    const assignee = await Staff.findById(assigneeId).select("_id isActive status").lean();
    if (!assignee?.isActive || assignee.status !== "active") return res.status(400).json({ success: false, message: "Assignee must be an active management staff member." });
    const previousValue = refund.managementCase?.toObject?.() || refund.managementCase || {};
    refund.managementCase = refund.managementCase || { notes: [] };
    refund.managementCase.assignedTo = assignee._id;
    refund.managementCase.status = "IN_REVIEW";
    await refund.save();
    await recordAdminAction({ req, action: "ASSIGN_EVENT_REFUND_CASE", targetType: "EventRefund", targetId: refund._id, previousValue, newValue: { assignedTo: assignee._id, status: "IN_REVIEW" } });
    return res.json({ success: true, data: refund });
  } catch (error) { console.error("[ASSIGN DIRECT REFUND CASE]", error); return res.status(500).json({ success: false, message: "Could not assign refund case." }); }
};

const addDirectRefundCaseNote = async (req, res) => {
  try {
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ success: false, message: "A case note is required." });
    const refund = await loadDirectRefundForAdmin(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: "Direct refund case not found." });
    refund.managementCase = refund.managementCase || { notes: [] };
    refund.managementCase.notes.push({ author: req.managementStaff?._id || req.user.id, body });
    if (refund.managementCase.status === "OPEN") refund.managementCase.status = "IN_REVIEW";
    await refund.save();
    await recordAdminAction({ req, action: "ADD_EVENT_REFUND_CASE_NOTE", targetType: "EventRefund", targetId: refund._id, metadata: { noteLength: body.length } });
    return res.status(201).json({ success: true, data: refund });
  } catch (error) { console.error("[DIRECT REFUND CASE NOTE]", error); return res.status(500).json({ success: false, message: "Could not add case note." }); }
};

const resolveDirectRefundCase = async (req, res) => {
  try {
    const resolution = String(req.body?.resolution || "").trim();
    if (!resolution) return res.status(400).json({ success: false, message: "A resolution note is required." });
    const refund = await loadDirectRefundForAdmin(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: "Direct refund case not found." });
    const previousValue = { caseStatus: refund.managementCase?.status, resolution: refund.managementCase?.resolution };
    refund.managementCase = refund.managementCase || { notes: [] };
    refund.managementCase.status = "RESOLVED";
    if (refund.supportRequest?.status === "OPEN") refund.supportRequest.status = "RESOLVED";
    refund.managementCase.resolution = resolution;
    refund.managementCase.resolvedAt = new Date();
    refund.managementCase.resolvedBy = req.managementStaff?._id || req.user.id;
    await refund.save();
    await recordAdminAction({ req, action: "RESOLVE_EVENT_REFUND_CASE", targetType: "EventRefund", targetId: refund._id, previousValue, newValue: { caseStatus: "RESOLVED", resolution } });
    return res.json({ success: true, data: refund });
  } catch (error) { console.error("[RESOLVE DIRECT REFUND CASE]", error); return res.status(500).json({ success: false, message: "Could not resolve refund case." }); }
};

module.exports = {
  getRefunds,
  getRefundDetail,
  assignDirectRefundCase,
  addDirectRefundCaseNote,
  resolveDirectRefundCase,
};
