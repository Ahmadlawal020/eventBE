const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const models = { event: Event, "event-center": EventCenter };
const decisions = ["APPROVED", "UNLISTED", "CANCELLED"];
const eligible = { $or: [
  { status: { $in: ["LISTED", "ACTION_REQUIRED", "UNLISTED", "COMPLETED"] } },
  { "moderation.reviewedAt": { $exists: true } },
] };
const statusExpression = { $ifNull: ["$moderation.status", "PENDING"] };
const serialize = (item, type) => ({
  ...item, listingType: type,
  displayName: item.title || item.venueName || "Untitled listing",
  moderation: { ...item.moderation, status: item.moderation?.status || "PENDING" },
});
const identity = (req, res) => {
  const model = Object.hasOwn(models, req.params.type) ? models[req.params.type] : null;
  if (!model || !mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, message: "Invalid listing type or ID" });
    return null;
  }
  return model;
};
exports.getQueue = async (req, res, next) => {
  try {
    const { type = "all", status = "PENDING", search = "" } = req.query;
    if (!["all", ...Object.keys(models)].includes(type) ||
        !["all", "PENDING", ...decisions].includes(status) || typeof search !== "string") {
      return res.status(400).json({ success: false, message: "Invalid moderation filter" });
    }
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 50000) return res.status(400).json({ success: false, message: "Invalid page number" });
    const limit = 20;
    const skip = (page - 1) * limit;
    const types = type === "all" ? Object.keys(models) : [type];
    const regex = new RegExp(search.slice(0, 150).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const results = await Promise.all(types.map(async listingType => {
      const model = models[listingType];
      const base = search ? { $and: [eligible, { [listingType === "event" ? "title" : "venueName"]: regex }] } : eligible;
      const query = status === "all" ? base : { $and: [base,
        { $expr: { $eq: [statusExpression, status] } },
      ] };
      const [items, total, counts] = await Promise.all([
        model.find(query).select("title venueName shortDescription status images createdBy createdAt updatedAt moderation.status moderation.reason moderation.reviewedAt")
          .populate("createdBy", "firstName surname email").sort({ createdAt: -1, _id: -1 }).limit(skip + limit).lean(),
        model.countDocuments(query),
        model.aggregate([{ $match: base }, { $group: { _id: statusExpression, count: { $sum: 1 } } }]),
      ]);
      return { items: items.map(item => serialize(item, listingType)), total, counts };
    }));
    const items = results.flatMap(result => result.items).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt) || String(b._id).localeCompare(String(a._id))
    ).slice(skip, skip + limit);
    const counts = { PENDING: 0, APPROVED: 0, UNLISTED: 0, CANCELLED: 0 };
    for (const result of results) for (const row of result.counts) counts[row._id] = (counts[row._id] || 0) + row.count;
    const total = results.reduce((sum, result) => sum + result.total, 0);
    res.json({ success: true, data: { items, counts, pagination: { page, total, pages: Math.ceil(total / limit) } } });
  } catch (error) { next(error); }
};
exports.getReview = async (req, res, next) => {
  try {
    const model = identity(req, res);
    if (!model) return;
    const item = await model.findOne({ $and: [{ _id: req.params.id }, eligible] })
      .select("-availability.unavailableDates -availability.unavailableSlots").select("+moderation.history")
      .populate("createdBy", "firstName surname email")
      .populate("moderation.history.reviewer", "firstName surname")
      .lean();
    if (!item) return res.status(404).json({ success: false, message: "Submitted listing not found" });
    res.json({ success: true, data: serialize(item, req.params.type) });
  } catch (error) { next(error); }
};
exports.decide = async (req, res, next) => {
  try {
    const model = identity(req, res);
    if (!model) return;
    const { decision, reason = "", updatedAt } = req.body;
    if (!decisions.includes(decision) || typeof reason !== "string" || reason.trim().length > 2000 ||
        (decision !== "APPROVED" && !reason.trim()) || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
      return res.status(400).json({ success: false, message: "Choose a valid decision, provide a reason for removal, and reload the current listing." });
    }
    const item = await model.findOne({ $and: [{ _id: req.params.id }, eligible] }).lean();
    if (!item) return res.status(404).json({ success: false, message: "Submitted listing not found" });
    if (decision === "APPROVED" && (item.status === "COMPLETED" ||
        (req.params.type === "event" && item.schedule?.to && new Date(item.schedule.to) <= new Date()))) {
      return res.status(409).json({ success: false, message: "An ended event cannot be made live. Its schedule must be updated first." });
    }
    const listingStatus = decision === "APPROVED" ? "LISTED" : "UNLISTED";
    const now = new Date();
    // Decision and history are written atomically; updatedAt prevents stale reviews and duplicate retries.
    const result = await model.findOneAndUpdate({ _id: item._id, updatedAt: new Date(updatedAt) }, {
      $set: { status: listingStatus, "moderation.status": decision, "moderation.reason": reason.trim(),
        "moderation.reviewedAt": now, "moderation.reviewedBy": req.user.id },
      $push: { "moderation.history": { decision, reason: reason.trim(), previousStatus: item.status,
        listingStatus, reviewer: req.user.id, createdAt: now } },
    }, { new: true, runValidators: true });
    if (!result) return res.status(409).json({ success: false, message: "This listing changed during review. Refresh it before deciding." });
    res.json({ success: true, data: { id: result._id, status: result.status } });
  } catch (error) { next(error); }
};
