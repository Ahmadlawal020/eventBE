const Review = require("../../models/client/ticketVoidReview.schema");
const { allowed } = require("./paymentExceptions.controller");
exports.list = async (req, res) => {
  if (!allowed(req)) return res.status(403).json({ message: "Finance access required" });
  try {
    const page = Math.max(1, Math.min(100000, parseInt(req.query.page) || 1));
    const filter = { status: "PENDING" };
    const [items, total] = await Promise.all([
      Review.find(filter).sort({ createdAt: 1 }).skip((page - 1) * 20).limit(20).populate("holder", "firstName surname email").populate("ticketId", "refundHold status").lean(),
      Review.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / 20) } });
  } catch { res.status(500).json({ message: "Could not load void reviews" }); }
};
exports.update = async (req, res) => {
  if (!allowed(req)) return res.status(403).json({ message: "Finance access required" });
  if (!require("mongoose").isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid review ID" });
  try { res.json({ success: true, data: await require("../../services/ticketVoidReview.service").reviewVoid(req.params.id, req.user.id, req.body) }); }
  catch (error) { res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Could not save review" }); }
};
