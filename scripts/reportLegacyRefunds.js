// Read-only reconciliation evidence. No payment submission, data repair or personal bank details.
require("dotenv").config();
const mongoose = require("mongoose");
async function main() {
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    const Refund = require("../models/client/eventRefund.schema"), Booking = require("../models/client/eventBooking.schema");
    const Ticket = require("../models/client/userEventTicket.schema"), Event = require("../models/client/event.schema");
    const rows = [];
    for (const refund of await Refund.find({ ticketId: null }).sort({ _id: 1 }).lean()) {
      const [booking, tickets, event] = await Promise.all([Booking.findById(refund.bookingId).lean(), Ticket.find({ bookingId: refund.bookingId }).lean(), Event.findById(refund.eventId).lean()]);
      let expectedMinor = null, reason = null;
      try { expectedMinor = require("../services/ticketRefundAllocation.service").allocateTicketRefunds(booking, tickets, event, refund.dueAt).reduce((sum, row) => sum + row.amountMinor, 0); }
      catch (error) { reason = error.message; }
      rows.push({ refundId: String(refund._id), bookingId: String(refund.bookingId), status: refund.status, currency: refund.currency,
        storedRefundMinor: refund.amountMinor, checkoutTicketSubtotalMinor: expectedMinor, checkoutTotalMinor: booking?.totalAmount,
        differenceMinor: expectedMinor == null ? null : refund.amountMinor - expectedMinor, ticketCount: tickets.length,
        recipientChanged: tickets.some(ticket => String(ticket.owner) !== String(refund.buyer)),
        markedPaid: Boolean(refund.markedPaidAt), receiptRecorded: Boolean(refund.receipt?.uploadedAt), confirmed: Boolean(refund.confirmedAt),
        reason: reason || (expectedMinor === refund.amountMinor ? "Verify recipient and settlement evidence before migration." : "Stored obligation differs from immutable checkout ticket subtotal; reconcile evidence before changing financial records.") });
    }
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, rows }, null, 2));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error("Refund evidence report failed:", error.name); process.exitCode = 1; });
