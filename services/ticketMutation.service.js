const Event = require("../models/client/event.schema");
const { eventEnd } = require("./eventEntry.service");
const fail = message => Object.assign(Error(message), { status: 409 });
async function lockTicketEvent(previous, session) {
  const event = await Event.findOneAndUpdate({
    _id: previous._id, status: previous.status, updatedAt: previous.updatedAt,
  }, { $inc: { saleVersion: 1 } }, { new: true, session });
  if (!event || ["CANCELLED", "COMPLETED"].includes(event.status) ||
      (Number.isFinite(eventEnd(event)) && eventEnd(event) <= Date.now()))
    throw fail("This event ended or changed. Refresh before editing tickets.");
  return event;
}
function validateOrderLimits(limits, maximum) {
  const min = Number(limits?.min ?? 1), max = Number(limits?.max ?? Math.min(50, maximum));
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || max > maximum)
    throw Object.assign(Error("Ticket order minimum and maximum must be whole numbers, with minimum no greater than maximum or the event order limit."), { status: 400 });
  return { min, max };
}
module.exports = { lockTicketEvent, validateOrderLimits };
