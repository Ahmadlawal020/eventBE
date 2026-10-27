const { ticketPriceMinor } = require("./eventRefundAmount.service");
const invalid = () => Object.assign(new Error("Ticket ownership or checkout totals are incomplete. Contact support before creating refunds."), { statusCode: 409 });
function allocateTicketRefunds(booking, tickets, event, dueAt) {
  const groups = new Map();
  for (const item of booking.items || []) {
    const key = String(item.ticketId);
    const amount = item.subtotalAmount ?? (Number(item.pricePerUnit) * Number(item.quantity));
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(amount) || amount < 0) throw invalid();
    const group = groups.get(key) || { quantity: 0, amount: 0 };
    group.quantity += item.quantity; group.amount += amount; groups.set(key, group);
  }
  if ([...groups.values()].reduce((sum, group) => sum + group.amount, 0) !== ticketPriceMinor(booking)) throw invalid();
  const result = [];
  for (const [type, group] of groups) {
    const owned = tickets.filter(ticket => String(ticket.bookingId) === String(booking._id) && String(ticket.ticketTypeId) === type)
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));
    if (owned.length !== group.quantity || owned.some(ticket => !ticket.owner)) throw invalid();
    owned.forEach((ticket, index) => {
      const amountMinor = Math.floor(group.amount / group.quantity) + (index < group.amount % group.quantity ? 1 : 0);
      if (!amountMinor) return;
      result.push({ eventId: event._id, bookingId: booking._id, ticketId: ticket._id,
        // Kept as `buyer` for API compatibility; this is the refund recipient.
        buyer: ticket.owner, originalBuyer: booking.buyer, organiser: event.createdBy,
        amountMinor, currency: booking.currency || "NGN", dueAt });
    });
  }
  return result;
}
function cancellationRefunds(bookings, tickets, event, dueAt) {
  const eligible = new Set(tickets.filter(ticket => ticket.status === "UNREDEEMED" && !ticket.refundHold &&
    (ticket.occurrence || 0) === (event.occurrence || 0)).map(ticket => String(ticket._id)));
  const eligibleBookings = new Set(tickets.filter(ticket => eligible.has(String(ticket._id))).map(ticket => String(ticket.bookingId)));
  return bookings.filter(booking => booking.paymentStatus === "COMPLETED" && Number(booking.totalAmount) > 0 && eligibleBookings.has(String(booking._id)))
    .flatMap(booking => allocateTicketRefunds(booking, tickets, event, dueAt))
    .filter(refund => eligible.has(String(refund.ticketId)));
}
module.exports = { allocateTicketRefunds, cancellationRefunds };
