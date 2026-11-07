const EventCenterRefund = require("../../models/client/eventCenterRefund.schema");
const mongoose = require("mongoose");
const Staff = require("../../models/management/staff.schema");
const { recordAdminAction } = require("../../services/management/adminAudit.service");
const getRefunds = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const filter = req.query.support === "open" ? { "supportRequest.status": "OPEN" } : {};
    if (req.query.search !== undefined && (typeof req.query.search !== "string" || req.query.search.length > 100)) return res.status(400).json({ message: "Invalid refund search." });
    if (req.query.search?.trim()) {
      const literal = new RegExp(req.query.search.trim().replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ resourceTitle: literal }, { organiserReference: literal }, { status: literal }];
    }
    const [refunds, total, metrics] = await Promise.all([
      EventCenterRefund.find(filter).select("+managementCase")
        .populate("buyer", "firstName surname email").populate("organiser", "firstName surname email")
        .populate("eventCenterId", "venueName").sort({ dueAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      EventCenterRefund.countDocuments(filter),
      EventCenterRefund.aggregate([{ $match: filter }, { $group: { _id: "$currency",
        confirmed: { $sum: { $cond: [{ $eq: ["$status", "CONFIRMED_BY_BUYER"] }, 1, 0] } },
        attention: { $sum: { $cond: [{ $in: ["$status", ["OVERDUE", "DISPUTED"]] }, 1, 0] } },
        volumeMinor: { $sum: { $ifNull: ["$confirmedMinor", { $cond: [{ $eq: ["$status", "CONFIRMED_BY_BUYER"] }, "$amountMinor", 0] }] } },
      } }]),
    ]);
    res.json({ success: true, data: { refunds: refunds.map(r => ({ ...r, eventCenter: r.eventCenterId, bookingType: "event-center-cancellation",
      paymentStatus: r.status, paymentReference: r.organiserReference || "DIRECT-" + r._id, totalAmount: r.amountMinor })),
      metrics: { refunded: metrics.reduce((n, r) => n + r.confirmed, 0), failed: metrics.reduce((n, r) => n + r.attention, 0),
        volume: metrics.length === 1 ? metrics[0].volumeMinor : null, currencies: metrics.map(r => ({ currency: r._id, volume: r.volumeMinor / 100 })) },
      pagination: { total, page, limit, pages: Math.ceil(total / limit) } } });
  } catch { res.status(500).json({ message: "Could not load event center refunds." }); }
};
const getRefundDetail = async (req, res) => {
  try {
    const refund = await loadDirectRefundForAdmin(req.params.id);
    if (!refund) return res.status(404).json({ message: "Refund not found." });
    res.json({ success: true, data: { refund: { ...refund.toObject(), eventCenter: refund.eventCenterId, bookingType: "event-center-cancellation", paymentStatus: refund.status, paymentReference: refund.organiserReference || "DIRECT-" + refund._id, totalAmount: refund.amountMinor } } });
  } catch { res.status(500).json({ message: "Could not load event center refund." }); }
};
async function loadDirectRefundForAdmin(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return EventCenterRefund.findById(id).select("+managementCase")
    .populate("buyer", "firstName surname email phoneNumber")
    .populate("organiser", "firstName surname email")
    .populate("eventCenterId", "venueName createdBy")
    .populate("managementCase.assignedTo", "firstName surname email")
    .populate("managementCase.notes.author", "firstName surname email");
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
    await recordAdminAction({ req, action: "ASSIGN_EVENT_CENTER_REFUND_CASE", targetType: "EventCenterRefund", targetId: refund._id, previousValue, newValue: { assignedTo: assignee._id, status: "IN_REVIEW" } });
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
    await recordAdminAction({ req, action: "ADD_EVENT_CENTER_REFUND_CASE_NOTE", targetType: "EventCenterRefund", targetId: refund._id, metadata: { noteLength: body.length } });
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
    await recordAdminAction({ req, action: "RESOLVE_EVENT_CENTER_REFUND_CASE", targetType: "EventCenterRefund", targetId: refund._id, previousValue, newValue: { caseStatus: "RESOLVED", resolution } });
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
