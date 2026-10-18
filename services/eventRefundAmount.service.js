// Use immutable checkout amounts, never today's ticket price or a fee-inclusive total.
function ticketPriceMinor(booking) {
  let amount = booking.subtotalAmount;
  if (amount == null && Array.isArray(booking.items) && booking.items.length) {
    amount = booking.items.reduce((sum, item) => sum + (
      item.subtotalAmount ?? item.totalPrice ?? Number(item.pricePerUnit) * Number(item.quantity)
    ), 0);
  }
  if (!Number.isSafeInteger(amount) || amount < 0 ||
      !Number.isSafeInteger(booking.totalAmount) || amount > booking.totalAmount) {
    throw Object.assign(new Error("A booking has invalid ticket-price totals. Contact support before cancelling."), { statusCode: 409 });
  }
  return amount;
}
module.exports = { ticketPriceMinor };
