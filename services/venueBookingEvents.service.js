const History = require("../models/client/bookingHistory.schema");
const { queueNotices } = require("./eventCenterRefundNotifications.service");
async function recordVenueEvent(booking, action, actor, session, extra = {}) {
  const [entry] = await History.create([{ eventCenter: booking.eventCenter, ticket: booking._id, bookingId: String(booking._id),
    bookingType: "PLATFORM", bookingUnit: booking.bookingUnit, action, performedBy: actor, dates: booking.selectedDates,
    guestName: booking.guestDetails?.fullName, totalPrice: booking.totalPrice, ...extra }], { session });
  if (["CREATED", "ACCEPTED", "RESCHEDULED"].includes(action) &&
      ["ACTIVE", "CONFIRMED"].includes(booking.status) && booking.paymentStatus === "COMPLETED") {
    await require("./venueRescheduleConflict.service").cancelConflictingRequests(booking.eventCenter, session);
  }
  const review = booking.status === "PENDING_REVIEW";
  const description = action === "CREATED" ? review ? "Payment received. Awaiting host approval by " + booking.reviewDeadline.toISOString() : "Payment received. Your venue booking is confirmed."
    : action === "ACCEPTED" ? "Your venue booking is confirmed. Organiser payout is tracked separately."
    : action === "COMPLETED" ? "Your venue booking has ended. You can now leave a review."
    : action === "RESCHEDULED" ? "Your booking dates have changed. Open the booking to review them."
    : extra.reason || "Your venue booking was updated.";
  await queueNotices([...new Set([String(booking.buyer), String(booking.organiser)])].map(recipient => ({
    key: `venue:${entry._id}:${recipient}`, recipient, type: "BOOKING_UPDATE", title: "Venue booking update", message: description,
    data: { screen: recipient === String(booking.buyer) ? "TicketDetails" : "VenueBookingOperations", ticketId: String(booking._id), bookingId: String(booking._id), venueId: String(booking.eventCenter) },
  })), session);
}
module.exports = { recordVenueEvent };
