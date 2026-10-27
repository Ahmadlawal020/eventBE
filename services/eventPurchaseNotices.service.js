const Event = require("../models/client/event.schema");
const { queueNotices } = require("./refundNotifications.service");
async function queueEventPurchase(booking, session) {
  const event = await Event.findById(booking.eventId).session(session).lean();
  if (!event) throw Error("Event missing while recording purchase confirmation");
  const count = booking.items.reduce((n, item) => n + item.quantity, 0);
  const notice = {
    key: "event-purchased:" + booking._id, recipient: booking.buyer, sender: event.createdBy,
    type: "TICKET_PURCHASED", title: "Tickets confirmed: " + event.title,
    message: count + ' ticket(s) for "' + event.title + '" are ready in Tickets. Reference: ' + booking.paymentReference,
    data: { screen: "Tickets", bookingId: String(booking._id), eventId: String(event._id) },
    receipt: { eventTitle: event.title, eventDate: event.schedule?.from, venueName: event.location?.addressString,
      ticketCount: count, totalAmount: booking.totalAmount, currency: booking.currency, bookingReference: booking.paymentReference },
  };
  const notices = [notice];
  if (event.createdBy) notices.push({
    key: "event-sale:" + booking._id, recipient: event.createdBy, sender: booking.buyer,
    type: "BOOKING_CREATED", title: "New ticket sale", message: count + ' ticket(s) purchased for "' + event.title + '".',
    data: { screen: "EventDetails", eventId: String(event._id) },
  });
  await queueNotices(notices, session);
}
module.exports = { queueEventPurchase };
