const Refund = require("../models/client/eventRefund.schema");
const Booking = require("../models/client/eventBooking.schema");
const Ticket = require("../models/client/userEventTicket.schema");
const Event = require("../models/client/event.schema");
const { allocateTicketRefunds } = require("./ticketRefundAllocation.service");
async function planLegacyRefund(id, session) {
  const refund = await Refund.findOne({ _id: id, ticketId: null }).select("+bankDetails.accountNumber +bankDetails.bankCode +receipt.publicId +managementCase").session(session).lean();
  if (!refund) return null;
  const booking = await Booking.findById(refund.bookingId).session(session).lean();
  const event = await Event.findById(refund.eventId).session(session).lean();
  const tickets = await Ticket.find({ bookingId: refund.bookingId }).session(session).lean();
  if (!booking || !event || !tickets.length) throw new Error("Missing booking, event or tickets; manual review required");
  const allocations = allocateTicketRefunds(booking, tickets, event, refund.dueAt);
  if (allocations.reduce((sum, row) => sum + row.amountMinor, 0) !== refund.amountMinor) throw new Error("Stored refund amount differs from checkout; manual review required");
  const protectedPayment = refund.markedPaidAt || refund.receipt?.uploadedAt || ["MARKED_PAID", "CONFIRMED_BY_BUYER", "DISPUTED"].includes(refund.status);
  if (protectedPayment && allocations.length > 1) throw new Error("Payment proof or settlement spans multiple tickets; manual settlement review required");
  if (protectedPayment && allocations.some(row => String(row.buyer) !== String(refund.buyer))) throw new Error("Payment or receipt already recorded for a different recipient; manual settlement review required");
  const { _id, __v, ticketId, pendingReceiptPublicId, ...previous } = refund;
  return allocations.map((allocation, index) => {
    const sameHolder = String(allocation.buyer) === String(refund.buyer);
    const row = { ...previous, ...allocation, ...(index === 0 ? { _id } : {}) };
    if (!sameHolder) {
      for (const key of ["bankDetails", "bankDetailsSubmittedAt", "receipt", "organiserReference", "markedPaidAt", "confirmationDueAt", "confirmedAt", "disputeReason", "managementCase"]) delete row[key];
      row.status = "AWAITING_BUYER_DETAILS";
    }
    return row;
  });
}
async function migrateLegacyRefund(id) {
  return require("mongoose").connection.transaction(async session => {
    const rows = await planLegacyRefund(id, session);
    if (!rows) return 0;
    // Preserve the original record ID and its audit history. No settled amount is added.
    const original = await Refund.collection.findOne({ _id: new (require("mongoose").Types.ObjectId)(String(id)) }, { session });
    await require("mongoose").connection.collection("eventrefund_holder_migration_backups").updateOne(
      { _id: original._id }, { $setOnInsert: { original, migratedAt: new Date() } }, { upsert: true, session });
    const [first, ...rest] = rows;
    const result = await Refund.replaceOne({ _id: id, ticketId: null }, first, { session, runValidators: true });
    if (result.modifiedCount !== 1) throw new Error("Refund changed during migration");
    if (rest.length) await Refund.insertMany(rest, { session });
    return rows.length;
  });
}
module.exports = { planLegacyRefund, migrateLegacyRefund };
