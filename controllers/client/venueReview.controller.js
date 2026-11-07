const mongoose = require("mongoose");
const Review = require("../../models/client/venueReview.schema");
const Booking = require("../../models/client/eventCenterBooking.schema");
const { bookingSessions } = require("../../services/bookingAttendance.service");
const handle = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.code === 11000 ? 409 : e.name === "CastError" ? 400 : 500).json({ message: e.code === 11000 ? "You already reviewed this booking." : "Could not complete the review request." }); } };
exports.mine = handle(async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, buyer: req.user.id }).lean();
  if (!booking) return res.status(404).json({ message: "Booking not found." });
  const sessions = bookingSessions(booking);
  const eligible = booking.paymentStatus === "COMPLETED" && !booking.paymentResolutionRequired && ["ACTIVE", "CONFIRMED", "COMPLETED"].includes(booking.status) && sessions.length > 0 && sessions.every(s => new Date(s.endsAt) <= new Date());
  res.json({ data: { eligible, review: await Review.findOne({ booking: booking._id, author: req.user.id }).select("-moderation").lean() } });
});
exports.create = handle(async (req, res) => {
  const { rating, reviewText } = req.body || {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || typeof reviewText !== "string" || !reviewText.trim() || reviewText.length > 2000) return res.status(400).json({ message: "Choose 1-5 stars and enter a review of up to 2000 characters." });
  const review = await mongoose.connection.transaction(async session => {
    // Serialize eligibility with transfers and cancellation.
    const booking = await Booking.findOneAndUpdate({ _id: req.params.id, buyer: req.user.id, paymentStatus: "COMPLETED", paymentResolutionRequired: { $ne: true }, status: { $in: ["ACTIVE", "CONFIRMED", "COMPLETED"] } }, { $inc: { __v: 1 } }, { new: true, session });
    const sessions = booking && bookingSessions(booking);
    if (!sessions?.length || sessions.some(s => new Date(s.endsAt) > new Date())) return null;
    return (await Review.create([{ booking: booking._id, venue: booking.eventCenter, author: req.user.id,
      authorName: booking.guestDetails?.fullName || "Verified guest", rating, reviewText: reviewText.trim() }], { session }))[0];
  });
  if (!review) return res.status(409).json({ message: "Reviews are available after your paid booking ends." });
  res.status(201).json({ data: review });
});
exports.public = handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.eventCenterId)) return res.status(400).json({ message: "Invalid venue." });
  const filter = { venue: new mongoose.Types.ObjectId(req.params.eventCenterId), status: "APPROVED" };
  const [reviews, totals] = await Promise.all([Review.find(filter).select("authorName rating reviewText createdAt").sort({ createdAt: -1 }).limit(50).lean(),
    Review.aggregate([{ $match: filter }, { $group: { _id: null, count: { $sum: 1 }, average: { $avg: "$rating" } } }])]);
  res.json({ data: { reviews, count: totals[0]?.count || 0, average: totals[0]?.average || null } });
});
exports.list = handle(async (req, res) => {
  const filter = ["APPROVED", "FLAGGED", "HIDDEN"].includes(req.query.status) ? { status: req.query.status } : {};
  const reviews = await Review.find(filter).populate("venue", "venueName").populate("author", "email").sort({ createdAt: -1 }).limit(500).lean();
  res.json({ data: reviews.map(r => ({ ...r, authorEmail: r.author?.email || "", subjectType: "VENUE", subjectTitle: r.venue?.venueName || "Venue", sentiment: r.rating > 3 ? "POSITIVE" : r.rating < 3 ? "NEGATIVE" : "NEUTRAL" })) });
});
exports.moderate = handle(async (req, res) => {
  if (!["APPROVED", "FLAGGED", "HIDDEN"].includes(req.body.status)) return res.status(400).json({ message: "Invalid review status." });
  const review = await Review.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status }, $push: { moderation: { status: req.body.status, actor: req.user.id, at: new Date() } } }, { new: true });
  if (!review) return res.status(404).json({ message: "Review not found." });
  res.json({ data: review });
});
