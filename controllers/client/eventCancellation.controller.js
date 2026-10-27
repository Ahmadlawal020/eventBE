const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const EventBooking = require("../../models/client/eventBooking.schema");
const UserEventTicket = require("../../models/client/userEventTicket.schema");
const TicketTransferRequest = require("../../models/client/ticketTransferRequest.schema");
const EventRefund = require("../../models/client/eventRefund.schema");
const { queueNotices, cancellationNotices } = require("../../services/refundNotifications.service");

const isOwner = (event, userId) => String(event.createdBy) === String(userId);
const validId = (id) => mongoose.Types.ObjectId.isValid(id);

async function cancellationPreview(req, res) {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const event = await Event.findById(req.params.id).select("title createdBy status occurrence").lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    if (!isOwner(event, req.user.id)) return res.status(403).json({ success: false, message: "Only the original organiser can cancel this event." });

    const bookings = await EventBooking.find({ eventId: event._id, paymentStatus: "COMPLETED" })
      .select("subtotalAmount totalAmount items currency buyer paymentStatus").lean();
    const paid = bookings.filter((booking) => Number(booking.totalAmount || 0) > 0);
    const tickets = await UserEventTicket.find({ eventId: event._id }).lean();
    const refunds = require("../../services/ticketRefundAllocation.service").cancellationRefunds(paid, tickets, event, new Date());
    const refundsByCurrency = refunds.reduce((result, refund) => {
      result[refund.currency] = (result[refund.currency] || 0) + refund.amountMinor;
      return result;
    }, {});
    const ticketCount = tickets.filter(ticket => ticket.status === "UNREDEEMED" && !ticket.refundHold && (ticket.occurrence || 0) === (event.occurrence || 0)).length;
    return res.json({ success: true, data: {
      event: { id: event._id, title: event.title, status: event.status },
      paidOrders: new Set(refunds.map(refund => String(refund.bookingId))).size,
      ticketCount,
      refundLiabilityMinorByCurrency: refundsByCurrency,
      note: "Refund liability is ticket price only. Munasaba platform fees are not refunded and Munasaba does not process these payments.",
    }});
  } catch (error) {
    console.error("[EVENT CANCELLATION PREVIEW]", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Could not calculate cancellation impact." });
  }
}

async function cancelEvent(req, res) {
  const { message, refundDueDays = 7, confirm } = req.body || {};
  if (confirm !== true) return res.status(400).json({ success: false, message: "Confirm cancellation before continuing." });
  if (typeof message !== "string" || !message.trim() || message.length > 1000) return res.status(400).json({ success: false, message: "A message to ticket holders between 1 and 1000 characters is required." });
  const days = Number(refundDueDays);
  if (!Number.isInteger(days) || days < 1 || days > 30) return res.status(400).json({ success: false, message: "Refund deadline must be between 1 and 30 days." });

  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid event ID." });
    const outcome = await mongoose.connection.transaction(async (session) => {
      const event = await Event.findById(req.params.id).session(session);
      if (!event) throw Object.assign(new Error("Event not found."), { statusCode: 404 });
      if (!isOwner(event, req.user.id)) throw Object.assign(new Error("Only the original organiser can cancel this event."), { statusCode: 403 });
      if (["CANCELLED", "COMPLETED"].includes(event.status)) throw Object.assign(new Error(`This event is already ${event.status.toLowerCase()}.`), { statusCode: 409 });

      const dueAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const bookings = await EventBooking.find({ eventId: event._id, paymentStatus: { $in: ["COMPLETED", "REFUNDED"] } }).session(session);
      const refundable = bookings.filter((booking) => booking.paymentStatus === "COMPLETED" && Number(booking.totalAmount || 0) > 0);
      const tickets = await UserEventTicket.find({ eventId: event._id }).session(session).lean();
      const { allocateTicketRefunds } = require("../../services/ticketRefundAllocation.service");
      const refundDocs = require("../../services/ticketRefundAllocation.service").cancellationRefunds(refundable, tickets, event, dueAt);
      if (refundDocs.length) await EventRefund.insertMany(refundDocs, { session, ordered: true });

      event.status = "CANCELLED";
      event.lifecycle = { cancellationMessage: message.trim(), cancelledAt: new Date(), cancelledBy: req.user.id, refundDueAt: dueAt };
      await event.save({ session });
      await UserEventTicket.updateMany(
        { eventId: event._id, status: "UNREDEEMED", refundHold: { $ne: true }, ...require("../../services/eventOccurrence.service").occurrenceFilter(event.occurrence || 0) },
        { $set: { status: "CANCELLED", invalidatedReason: "EVENT_CANCELLED", invalidatedAt: new Date() } },
        { session },
      );
      await TicketTransferRequest.updateMany(
        { ticketCategory: "USER_EVENT", status: "PENDING", ticketId: { $in: (await UserEventTicket.find({ eventId: event._id }).session(session).select("_id").lean()).map((ticket) => ticket._id) } },
        { $set: { status: "CANCELLED" } }, { session },
      );
      const ticketOwners = await UserEventTicket.distinct("owner", { eventId: event._id }).session(session);
      // Notify purchasers about cancellation too; refund access belongs to current holders.
      const refundBuyers = bookings.filter((booking) => booking.buyer).map((booking) => String(booking.buyer));
      const recipients = [...new Set([...ticketOwners.map(String), ...refundBuyers])];
      await queueNotices(cancellationNotices(event, recipients), session);
      return { event, dueAt, paidOrders: refundable.length, recipients };
    });

    return res.json({ success: true, message: "Event cancelled. Buyer notices are queued for delivery.", data: {
      paidOrders: outcome.paidOrders, refundDueAt: outcome.dueAt,
      notifications: { queued: outcome.recipients.length },
    } });
  } catch (error) {
    console.error("[CANCEL EVENT]", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Could not cancel event." });
  }
}

module.exports = { cancellationPreview, cancelEvent };
