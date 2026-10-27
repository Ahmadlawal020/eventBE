const mongoose = require("mongoose");
const Event = require("../models/client/event.schema");
const Tickets = require("../models/client/userEventTicket.schema");
const Booking = require("../models/client/eventBooking.schema");
const Review = require("../models/client/ticketVoidReview.schema");
const { assertEntryOpen } = require("./eventEntry.service");
const { assertTicketOccurrence } = require("./eventOccurrence.service");
const { queueNotices } = require("./refundNotifications.service");
const fail = message => Object.assign(Error(message), { statusCode: 409 });
async function requestVoid(ticketId, actor) {
  return mongoose.connection.transaction(async session => {
    const ticket = await Tickets.findById(ticketId).session(session);
    if (!ticket || ticket.status !== "UNREDEEMED") throw fail("Only an unused ticket can be reviewed or voided.");
    const event = await Event.findOneAndUpdate({ _id: ticket.eventId }, { $inc: { saleVersion: 1 } }, { new: true, session });
    assertEntryOpen(event); assertTicketOccurrence(ticket, event);
    const booking = await Booking.findById(ticket.bookingId).session(session);
    if (!booking || booking.paymentStatus !== "COMPLETED") throw fail("Verify the original payment before voiding this ticket.");
    if (booking.totalAmount > 0) {
      const tickets = await Tickets.find({ bookingId: booking._id }).session(session).lean();
      const allocation = require("./ticketRefundAllocation.service").allocateTicketRefunds(booking, tickets, event, new Date())
        .find(row => String(row.ticketId) === String(ticket._id));
      if (!allocation) throw fail("The refund amount requires finance investigation.");
      const review = await Review.findOneAndUpdate({ ticketId }, { $setOnInsert: {
        eventId: ticket.eventId, holder: ticket.owner, requestedBy: actor, ticketNumber: ticket.ticketNumber,
        occurrence: ticket.occurrence || 0, amountMinor: allocation.amountMinor, currency: allocation.currency, status: "PENDING",
      } }, { upsert: true, new: true, session });
      if (review.status === "APPROVED") throw fail("This ticket already has a completed review. Contact finance.");
      if (review.status === "REJECTED") {
        review.history.push({ status: review.status, notes: review.notes, reviewedAt: review.reviewedAt, reviewedBy: review.reviewedBy,
          holder: review.holder, reopenedAt: new Date(), reopenedBy: actor });
        Object.assign(review, { status: "PENDING", holder: ticket.owner, requestedBy: actor, ticketNumber: ticket.ticketNumber,
          occurrence: ticket.occurrence || 0, amountMinor: allocation.amountMinor, currency: allocation.currency,
          notes: undefined, reviewedAt: undefined, reviewedBy: undefined, heldAt: undefined, settlementReference: undefined });
        await review.save({ session });
      }
      return { reviewRequired: true, reviewId: review._id, ticket };
    }
    ticket.status = "CANCELLED"; ticket.invalidatedReason = "STAFF_CANCELLED"; ticket.invalidatedAt = new Date();
    await ticket.save({ session });
    return { reviewRequired: false, ticket };
  });
}
async function reviewVoid(id, actor, body) {
  if (!["PREPARE", "APPROVE", "REJECT"].includes(body.action) || typeof body.notes !== "string" || body.notes.trim().length < 10 || body.notes.length > 2000)
    throw Object.assign(Error("Choose a decision and provide review notes of 10 to 2000 characters."), { statusCode: 400 });
  if (body.action === "APPROVE" && (body.confirmRefundSettled !== true || typeof body.settlementReference !== "string" || body.settlementReference.trim().length < 5 || body.settlementReference.length > 200))
    throw Object.assign(Error("Verify the refund was settled and provide its reference before approving the void."), { statusCode: 400 });
  return mongoose.connection.transaction(async session => {
    const review = await Review.findOne({ _id: id, status: "PENDING" }).session(session);
    if (!review) throw fail("This review is no longer pending.");
    const before = review.toObject();
    // All entry, transfer, cancellation and completion paths serialize on this event.
    const event = await Event.findOneAndUpdate({ _id: review.eventId }, { $inc: { saleVersion: 1 } }, { new: true, session });
    const ticket = await Tickets.findById(review.ticketId).session(session);
    if (body.action === "PREPARE") {
      assertEntryOpen(event);
      if (!ticket || ticket.status !== "UNREDEEMED" || String(ticket.owner) !== String(review.holder) ||
          ticket.ticketNumber !== review.ticketNumber || (ticket.occurrence || 0) !== review.occurrence)
        throw fail("Ticket ownership or validity changed. Reject and request a fresh review before sending money.");
      assertTicketOccurrence(ticket, event);
      ticket.refundHold = true;
      await ticket.save({ session });
      review.heldAt = review.heldAt || new Date();
      await require("../models/client/ticketTransferRequest.schema").updateMany(
        { ticketId: ticket._id, ticketCategory: "USER_EVENT", status: "PENDING" },
        { $set: { status: "CANCELLED" } }, { session });
    } else if (body.action === "APPROVE") {
      // Settlement may finish after cancellation/completion: held tickets stay reserved for this decision.
      if (!ticket?.refundHold || !review.heldAt) throw fail("Place the ticket on settlement hold before sending a refund.");
      if (ticket.status !== "UNREDEEMED" || String(ticket.owner) !== String(review.holder) ||
          ticket.ticketNumber !== review.ticketNumber || (ticket.occurrence || 0) !== review.occurrence)
        throw fail("Ticket ownership or validity changed. Contact finance recovery before recording settlement.");
      ticket.status = "CANCELLED"; ticket.refundHold = false;
      ticket.invalidatedReason = "STAFF_CANCELLED"; ticket.invalidatedAt = new Date();
      await ticket.save({ session });
      review.status = "APPROVED";
      review.settlementReference = body.settlementReference.trim();
    } else {
      if (ticket?.refundHold) {
        if (body.confirmNoSettlement !== true) throw fail("Confirm no refund was sent before releasing the settlement hold.");
        ticket.refundHold = false;
        if (event?.status === "CANCELLED") {
          const booking = await Booking.findById(ticket.bookingId).session(session);
          const all = await Tickets.find({ bookingId: ticket.bookingId }).session(session).lean();
          const allocation = require("./ticketRefundAllocation.service").allocateTicketRefunds(booking, all, event,
            event.lifecycle?.refundDueAt || new Date()).find(row => String(row.ticketId) === String(ticket._id));
          if (allocation) await require("../models/client/eventRefund.schema").updateOne({ ticketId: ticket._id },
            { $setOnInsert: allocation }, { upsert: true, session, runValidators: true });
          ticket.status = "CANCELLED"; ticket.invalidatedReason = "EVENT_CANCELLED"; ticket.invalidatedAt = new Date();
        } else if (!event || require("./eventOccurrence.service").occurrenceEnded(event)) {
          ticket.status = "EXPIRED"; ticket.invalidatedReason = "EVENT_COMPLETED"; ticket.invalidatedAt = new Date();
        }
        await ticket.save({ session });
      }
      review.status = "REJECTED";
    }
    review.history.push({ action: body.action, actor, at: new Date(), notes: body.notes.trim() });
    review.notes = body.notes.trim(); review.reviewedAt = new Date(); review.reviewedBy = actor;
    await review.save({ session });
    await require("../models/management/adminAuditLog.schema").create([{ admin: actor, action: "TICKET_VOID_" + body.action,
      targetType: "Ticket", targetId: review.ticketId, previousValue: before, newValue: review.toObject() }], { session });
    await queueNotices([{ key: "ticket-void:" + review._id + ":" + review.history.length, recipient: review.holder, type: "SYSTEM",
      title: body.action === "PREPARE" ? "Ticket held for refund settlement" : body.action === "APPROVE" ? "Ticket voided after refund review" : "Ticket refund review updated",
      message: body.action === "PREPARE" ? "Entry and transfers are on hold while finance settles your refund." :
        body.action === "APPROVE" ? "Finance recorded a refund and voided your ticket. Contact support if the refund has not arrived." :
        "Finance rejected the void request. Open your ticket for its current status and any event cancellation refund.",
      data: { screen: "Tickets", ticketId: String(review.ticketId) } }], session);
    return review;
  });
}
module.exports = { requestVoid, reviewVoid };
