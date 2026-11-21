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
  const deadlineText = booking.reviewDeadline
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: process.env.BOOKING_TIME_ZONE || "Africa/Lagos",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(booking.reviewDeadline))
    : "";
  const guestDescription = action === "CREATED" ? review ? `Payment received. Awaiting host approval by ${deadlineText}.` : "Payment received. Your venue booking is confirmed."
    : action === "ACCEPTED" ? "Your venue booking is confirmed. Organiser payout is tracked separately."
    : action === "COMPLETED" ? "Your venue booking has ended. You can now leave a review."
    : action === "RESCHEDULED" ? "Your booking dates have changed. Open the booking to review them."
    : extra.reason || "Your venue booking was updated.";
  const organiserDescription = action === "CREATED" && review
    ? `A guest paid for a booking request. Accept or decline before ${deadlineText}.`
    : guestDescription;
  let coOrganisers = [];
  if (action === "CREATED" && review && booking.eventCenter) {
    const Venue = require("../models/client/eventCenter.schema");
    const venueDoc = await Venue.findById(booking.eventCenter).select("coOrganisers").session(session).lean();
    coOrganisers = (venueDoc?.coOrganisers || []).map(String);
  }
  await queueNotices([...new Set([String(booking.buyer), String(booking.organiser), ...coOrganisers])].map(recipient => {
    const isBuyer = recipient === String(booking.buyer);
    return {
      key: `venue:${entry._id}:${recipient}`,
      recipient,
      type: "BOOKING_UPDATE",
      title: !isBuyer && action === "CREATED" && review ? "New booking request — action required" : "Venue booking update",
      message: isBuyer ? guestDescription : organiserDescription,
      data: { screen: isBuyer ? "TicketDetails" : "VenueBookingOperations", ticketId: String(booking._id), bookingId: String(booking._id), venueId: String(booking.eventCenter) },
    };
  }), session);
}
module.exports = { recordVenueEvent };
