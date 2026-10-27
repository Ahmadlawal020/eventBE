const Booking = require("../models/client/eventBooking.schema");
function revenueBookingFilter(eventIds, overrides = {}) {
  return { eventId: { $in: eventIds }, paymentStatus: "COMPLETED", ...overrides,
    status: { $ne: "CANCELLED" }, paymentResolutionRequired: { $ne: true } };
}
// Historical revenue uses saved order lines and fees, never mutable tier prices
// or inventory reservations. Returned amounts remain in integer minor units.
async function getEventRevenue(eventIds) {
  if (!eventIds.length) return new Map();
  const rows = await Booking.aggregate([
    { $match: revenueBookingFilter(eventIds) },
    { $project: { eventId: 1, organiserPayoutAmount: 1, organiserFeeAmount: 1,
      lines: { $map: { input: "$items", as: "item", in: {
        ticketId: "$$item.ticketId", quantity: "$$item.quantity",
        gross: { $ifNull: ["$$item.subtotalAmount", { $ifNull: ["$$item.totalPrice",
          { $multiply: ["$$item.pricePerUnit", "$$item.quantity"] }] }] },
        fee: { $ifNull: ["$$item.organiserFeeAmount", 0] },
      } } } } },
    { $set: { orderGross: { $sum: "$lines.gross" }, lineFees: { $sum: "$lines.fee" } } },
    { $set: { orderAdjustment: { $subtract: [
      { $subtract: ["$orderGross", "$lineFees"] },
      { $ifNull: ["$organiserPayoutAmount", { $subtract: ["$orderGross", { $ifNull: ["$organiserFeeAmount", "$lineFees"] }] }] },
    ] }, line: "$lines" } },
    { $unwind: { path: "$line", includeArrayIndex: "lineIndex" } },
    { $set: { previousGross: { $sum: { $map: { input: { $slice: ["$lines", "$lineIndex"] },
      as: "previous", in: "$$previous.gross" } } } } },
    // Distribute order-level fees using cumulative integer rounding so all tier
    // nets add up exactly to the saved payout, including capped/fixed fees.
    { $set: { adjustment: { $cond: [{ $gt: ["$orderGross", 0] }, { $subtract: [
      { $floor: { $divide: [{ $multiply: ["$orderAdjustment", { $add: ["$previousGross", "$line.gross"] }] }, "$orderGross"] } },
      { $floor: { $divide: [{ $multiply: ["$orderAdjustment", "$previousGross"] }, "$orderGross"] } },
    ] }, 0] } } },
    { $group: { _id: { eventId: "$eventId", ticketId: "$line.ticketId" },
      grossRevenueCents: { $sum: "$line.gross" },
      netRevenueCents: { $sum: { $subtract: [{ $subtract: ["$line.gross", "$line.fee"] }, "$adjustment"] } },
      paidQuantity: { $sum: "$line.quantity" },
    } },
  ]);
  const events = new Map();
  for (const row of rows) {
    const id = String(row._id.eventId);
    const total = events.get(id) || { grossRevenueCents: 0, netRevenueCents: 0, paidQuantity: 0, tiers: new Map() };
    for (const key of ["grossRevenueCents", "netRevenueCents", "paidQuantity"]) total[key] += row[key];
    total.tiers.set(String(row._id.ticketId), row);
    events.set(id, total);
  }
  return events;
}
module.exports = { getEventRevenue, revenueBookingFilter };
