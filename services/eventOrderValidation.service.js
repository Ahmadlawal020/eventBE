const fail = (message) => {
  throw Object.assign(new Error(message), { statusCode: 400 });
};
function validateEventOrderItems(items, maxTickets = 100) {
  if (!Array.isArray(items) || !items.length || items.length > maxTickets)
    fail("Select valid ticket items.");
  let total = 0;
  const products = new Set();
  for (const item of items) {
    if (
      !item ||
      typeof item.product !== "string" ||
      !/^[a-f0-9]{24}$/i.test(item.product) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1
    )
      fail(
        "Each ticket must have a valid product and positive whole quantity.",
      );
    const key = item.product.toLowerCase();
    if (products.has(key))
      fail("Combine each ticket type into one order item.");
    products.add(key);
    total += item.quantity;
    if (!Number.isSafeInteger(total) || total > maxTickets)
      fail(`A single order can contain at most ${maxTickets} tickets.`);
  }
  return total;
}
function assertTierOrderLimit(ticket, quantity) {
  const min = ticket.perTransactionLimit?.min || 1,
    max = ticket.perTransactionLimit?.max || 100;
  if (quantity < min || quantity > max)
    fail(`Select between ${min} and ${max} tickets for ${ticket.name}.`);
}
module.exports = { validateEventOrderItems, assertTierOrderLimit };
