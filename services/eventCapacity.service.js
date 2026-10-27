const Booking = require("../models/client/eventBooking.schema");
const Ticket = require("../models/client/userEventTicket.schema");
const { occurrenceFilter } = require("./eventOccurrence.service");
// Call under the event write lock for mutations; quotes are advisory snapshots.
async function assertEventCapacity(event, requested = 0, session = null) {
  if (event.capacity == null) return;
  if (!Number.isSafeInteger(event.capacity) || event.capacity < 0)
    throw Object.assign(Error("Event capacity must be a non-negative whole number."), { status: 400, statusCode: 400 });
  const scope = { eventId: event._id, ...occurrenceFilter(event.occurrence || 0) };
  const issued = await Ticket.countDocuments({ ...scope,
    $and: [{ $or: [{ status: { $in: ["UNREDEEMED", "REDEEMED"] } }, { refundHold: true }] }],
  }).session(session);
  // Do not drop expired holds until reconciliation has released their inventory.
  const pending = await Booking.find({ ...scope, paymentStatus: "PENDING", status: "ACTIVE", inventoryReserved: true })
    .select("items.quantity").session(session).lean();
  const held = pending.reduce((total, booking) => total + booking.items.reduce((sum, item) => sum + item.quantity, 0), 0);
  if (issued + held + requested > event.capacity)
    throw Object.assign(Error("Event capacity reached. Reduce the order or contact the organiser."), { status: 409, statusCode: 409 });
}
module.exports = { assertEventCapacity };
