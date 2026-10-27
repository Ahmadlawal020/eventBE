const mongoose = require("mongoose");
const Event = require("../models/client/event.schema");
const Tickets = require("../models/client/userEventTicket.schema");
const Transfers = require("../models/client/ticketTransferRequest.schema");
const { eventEnd } = require("./eventEntry.service");
const { queueNotices } = require("./refundNotifications.service");
const occurrenceFilter = occurrence => occurrence
  ? { occurrence }
  : { $or: [{ occurrence: 0 }, { occurrence: { $exists: false } }] };
const occurrenceEnded = (event, now = Date.now()) =>
  event.status === "COMPLETED" || (Number.isFinite(eventEnd(event)) && eventEnd(event) <= now);
function assertTicketOccurrence(ticket, event) {
  const end = ticket.validSchedule?.to || ticket.eventSnapshot?.schedule?.endDate;
  if ((ticket.occurrence || 0) !== (event.occurrence || 0) ||
      (!end || !Number.isFinite(new Date(end).getTime()) || new Date(end).getTime() <= Date.now()))
    throw Object.assign(Error("This ticket has expired."), { statusCode: 409 });
}
async function expireUnused(event, session) {
  const filter = { eventId: event._id, refundHold: { $ne: true }, ...occurrenceFilter(event.occurrence || 0) };
  const ids = await Tickets.find({ ...filter, status: { $in: ["UNREDEEMED", "EXPIRED"] } }).select("_id").session(session).lean();
  await Tickets.updateMany({ ...filter, status: "UNREDEEMED" },
    { $set: { status: "EXPIRED", invalidatedReason: "EVENT_COMPLETED", invalidatedAt: new Date() } }, { session });
  if (ids.length) await Transfers.updateMany({ ticketCategory: "USER_EVENT", ticketId: { $in: ids.map(t => t._id) }, status: "PENDING" },
    { $set: { status: "CANCELLED" } }, { session });
}
async function completeOccurrence(id, completionFilter) {
  return mongoose.connection.transaction(async session => {
    const event = await Event.findOneAndUpdate({ _id: id, ...completionFilter },
      { $set: { status: "COMPLETED" }, $inc: { saleVersion: 1 } }, { new: true, session });
    if (!event) return false;
    await expireUnused(event, session);
    return true;
  });
}
async function changeSchedule(previous, patch, policy, session) {
  const ended = occurrenceEnded(previous);
  if (policy !== undefined && !["EXPIRE", "HONOUR"].includes(policy))
    throw Object.assign(Error("Choose EXPIRE or HONOUR for previous unused tickets."), { status: 400 });
  if (policy !== undefined && (!ended || !patch.schedule))
    throw Object.assign(Error("Previous-ticket policy is only available when scheduling an ended event again."), { status: 400 });
  if (!ended || !patch.schedule) return false;
  const from = new Date(patch.schedule.from).getTime(), to = new Date(patch.schedule.to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= Date.now() || to <= from)
    throw Object.assign(Error("Choose a future start and end for the next occurrence."), { status: 400 });
  if (await Tickets.exists({ eventId: previous._id, refundHold: true }).session(session))
    throw Object.assign(Error("Resolve tickets held for refund settlement before starting another occurrence."), { status: 409 });
  await expireUnused(previous, session);
  patch.occurrence = (previous.occurrence || 0) + 1;
  if (policy === "HONOUR") {
    const filter = { eventId: previous._id, ...occurrenceFilter(previous.occurrence || 0), status: "EXPIRED", invalidatedReason: "EVENT_COMPLETED" };
    const tickets = await Tickets.find(filter).session(session).lean();
    await Tickets.updateMany(filter, {
      $set: { occurrence: patch.occurrence, status: "UNREDEEMED", invalidatedReason: null, validSchedule: patch.schedule },
      $unset: { invalidatedAt: 1 },
      $push: { occurrenceHistory: { occurrence: previous.occurrence || 0, schedule: previous.schedule, carriedAt: new Date() } },
    }, { session });
    await queueNotices([...new Set(tickets.map(t => String(t.owner)))].map(recipient => ({
      key: "event-carry:" + previous._id + ":" + patch.occurrence + ":" + recipient,
      recipient, sender: previous.createdBy, type: "SYSTEM", title: "Your unused ticket has new dates",
      message: 'The organiser will honour your unused ticket for "' + previous.title + '" on ' + new Date(from).toISOString() + '. Open Tickets for details.',
      data: { eventId: String(previous._id), screen: "Tickets" },
    })), session);
  }
  return true;
}
module.exports = { assertTicketOccurrence, occurrenceFilter, occurrenceEnded, expireUnused, completeOccurrence, changeSchedule };
