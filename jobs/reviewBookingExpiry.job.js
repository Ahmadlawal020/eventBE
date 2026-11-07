const Booking = require("../models/client/eventCenterBooking.schema");
const { cancelVenueBooking } = require("../services/venueLifecycle.service");
async function processExpiredReviews() {
  const bookings = await Booking.find({ status: "PENDING_REVIEW", $or: [{ reviewDeadline: { $lte: new Date() } }, { "selectedDates.date": { $lte: new Date() } }] })
    .sort({ reviewDeadline: 1, _id: 1 }).limit(500).select("_id selectedDates bookingUnit reviewDeadline").lean();
  let failed = 0;
  for (const booking of bookings) {
    if (require("../services/venueReviewPolicy.service").reviewDeadline(booking) > new Date()) continue;
    try { await cancelVenueBooking(booking._id, { mode: "expire", reason: "Review deadline expired" }); }
    catch (error) { failed++; console.error("[Review Expiry]", String(booking._id), error.message); }
  }
  return { processed: bookings.length, failed };
}
const expirePendingBookings = () => require("../services/eventOperations.service").runWorker("venue-review-expiry", processExpiredReviews);
module.exports = { expirePendingBookings };
