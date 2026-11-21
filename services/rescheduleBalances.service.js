const mongoose = require("mongoose");
const Venue = require("../models/client/eventCenter.schema");
const Booking = require("../models/client/eventCenterBooking.schema");
const Operations = require("../models/client/bookingOperations.schema");
const { requireVenuePermission, fail } = require("./venueAccess.service");
const { paymentSummary } = require("./bookingOperations.service");
function outstanding(booking, record) {
  if (!record.rescheduleAdjustment || !["ACTIVE", "CONFIRMED", "COMPLETED"].includes(booking.status)) return null;
  const summary = paymentSummary(booking, record);
  const awaitingConfirmationMinor = (record.refunds || []).filter(r => r.status === "SENT").reduce((sum, r) => sum + r.amountMinor, 0);
  if (!summary.balanceMinor && !summary.refundDueMinor && !awaitingConfirmationMinor) return null;
  return { bookingId: String(booking._id), bookingType: booking.bookingType === "MANUAL" ? "MANUAL" : "PLATFORM",
    guestName: booking.guestDetails?.fullName || booking.guestName || "Guest", status: booking.status,
    dates: booking.selectedDates || booking.dates || [], summary, awaitingConfirmationMinor };
}
async function list(venueId, actor) {
  if (!mongoose.isValidObjectId(venueId)) throw fail(400, "Invalid venue.");
  const venue = await Venue.findById(venueId).lean();
  await requireVenuePermission(actor, venue, ["VIEW_FINANCES"]);
  const records = await Operations.find({ eventCenter: venueId, rescheduleAdjustment: true }).sort({ updatedAt: -1 }).lean();
  const ids = records.map(r => r.bookingId).filter(id => mongoose.isValidObjectId(id));
  const [platform, manual] = await Promise.all([
    Booking.find({ _id: { $in: ids }, eventCenter: venueId }).lean(),
    records.some(r => r.bookingId.startsWith("manual-")) ? require("./manualBookingRead.service").getManualBookings([venue]) : [],
  ]);
  const bookings = new Map([...platform, ...manual].map(b => [String(b._id), b]));
  return { venueName: venue.venueName, items: records.flatMap(record => {
    const booking = bookings.get(record.bookingId);
    const item = booking && outstanding(booking, record);
    return item ? [item] : [];
  }) };
}
module.exports = { list, outstanding };
