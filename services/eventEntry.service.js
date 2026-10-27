const mongoose = require("mongoose");
const Event = require("../models/client/event.schema");
const Ticket = require("../models/client/userEventTicket.schema");
const fail = (message, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
function eventEnd(event) {
  if (event?.schedule?.to) return new Date(event.schedule.to).getTime();
  return event?.schedule?.from
    ? new Date(event.schedule.from).getTime() + 86400000
    : null;
}
function assertEntryOpen(event, now = Date.now()) {
  if (!event || !["LISTED", "UNLISTED"].includes(event.status))
    throw fail("Entry is closed for this event.");
  const end = eventEnd(event);
  if (end == null || !Number.isFinite(end) || end <= now)
    throw fail("This event has ended. Entry is closed.");
}
function isEntryClosed(event, now = Date.now()) {
  try {
    assertEntryOpen(event, now);
    return false;
  } catch {
    return true;
  }
}
// Read-only preview shares the occurrence, end-date and hold restrictions of check-in.
function ticketEntryPreview(ticket, event, now = Date.now()) {
  const end = ticket.validSchedule?.to || ticket.eventSnapshot?.schedule?.endDate;
  const validityExpired = (ticket.occurrence || 0) !== (event?.occurrence || 0) ||
    !end || !Number.isFinite(new Date(end).getTime()) || new Date(end).getTime() <= now;
  const eventClosed = isEntryClosed(event, now);
  const status = ticket.status === "UNREDEEMED" && validityExpired ? "EXPIRED" : ticket.status;
  const entryClosed = eventClosed || Boolean(ticket.refundHold) || validityExpired ||
    ["CANCELLED", "EXPIRED"].includes(status);
  const canCheckIn = !entryClosed && status === "UNREDEEMED" && !ticket.checkIn?.isCheckedIn;
  return {
    status, entryClosed, canCheckIn, refundHold: Boolean(ticket.refundHold),
    eventDate: ticket.validSchedule?.from || ticket.eventSnapshot?.schedule?.startDate || event?.schedule?.from,
    entryReason: validityExpired ? "This ticket has expired or belongs to a previous event occurrence." :
      ticket.refundHold ? "Entry is on hold during manual refund settlement." :
      eventClosed ? "Entry is closed for this event." :
      status === "REDEEMED" || ticket.checkIn?.isCheckedIn ? "This ticket has already been used." : undefined,
  };
}
async function checkInEventTicket({
  eventId,
  ticketId,
  ticketNumber,
  actor,
  method = "MANUAL",
}) {
  return mongoose.connection.transaction(async (session) => {
    // A write serializes check-in with cancellation, completion and transfer.
    const event = await Event.findOneAndUpdate(
      { _id: eventId, status: { $in: ["LISTED", "UNLISTED"] } },
      { $inc: { saleVersion: 1 } },
      { new: true, session },
    );
    assertEntryOpen(event);
    const ticket = await Ticket.findOneAndUpdate(
      {
        eventId,
        ...(ticketId ? { _id: ticketId } : {}),
        ...(ticketNumber ? { ticketNumber } : {}),
        status: "UNREDEEMED", refundHold: { $ne: true },
        $and: [{ $or: [
          { "validSchedule.to": { $gt: new Date() } },
          { "validSchedule.to": null, "eventSnapshot.schedule.endDate": { $gt: new Date() } },
        ] }],
        ...require("./eventOccurrence.service").occurrenceFilter(event.occurrence || 0),
      },
      {
        $set: {
          status: "REDEEMED",
          redeemedAt: new Date(),
          redeemedBy: actor,
          "checkIn.isCheckedIn": true,
          "checkIn.checkedInAt": new Date(),
          "checkIn.checkedInBy": actor,
          "checkIn.method": method,
        },
      },
      { new: true, session },
    ).populate("owner", "firstName surname email");
    return ticket;
  });
}
module.exports = {
  eventEnd,
  assertEntryOpen,
  isEntryClosed,
  checkInEventTicket,
  ticketEntryPreview,
};
