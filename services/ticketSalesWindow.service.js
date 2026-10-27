function salesWindowError(event, salesStartAt, salesEndAt, cutoffMinutes = 0) {
  const eventEndAnchor = event?.schedule?.to || event?.schedule?.from;
  const eventEnd = eventEndAnchor ? new Date(eventEndAnchor).getTime() : null;

  if (salesStartAt) {
    const salesStart = new Date(salesStartAt).getTime();
    if (!Number.isFinite(salesStart)) {
      return "Choose a valid ticket sales start date and time.";
    }
    // Organisers can start selling tickets well before the event starts.
    // Ticket sales cannot start after the event has already concluded.
    if (eventEnd && Number.isFinite(eventEnd) && salesStart > eventEnd) {
      return "Ticket sales cannot start after the event has ended.";
    }
  }

  if (salesEndAt) {
    const salesEnd = new Date(salesEndAt).getTime();
    if (!Number.isFinite(salesEnd)) {
      return "Choose a valid ticket sales end date and time.";
    }

    if (salesStartAt) {
      const salesStart = new Date(salesStartAt).getTime();
      if (Number.isFinite(salesStart) && salesEnd <= salesStart) {
        return "Ticket sales end date must be after the start date.";
      }
    }

    // The sales end shouldn't be after the event has ended.
    if (eventEnd && Number.isFinite(eventEnd) && salesEnd > eventEnd) {
      return "Ticket sales must end no later than the event end date and time.";
    }
  }

  return null;
}

function salesEndError(event, salesEndAt, cutoffMinutes = 0) {
  return salesWindowError(event, null, salesEndAt, cutoffMinutes);
}

/**
 * Realigns existing ticket sales windows for an event when the event is rescheduled to end earlier.
 * Clamps salesEndAt to the new event end time only if it exceeds it.
 * Also clamps salesStartAt if it happens to exceed the new event end time.
 * Returns the count of affected tickets.
 */
async function realignTicketSalesWindows(eventId, newEventEnd, TicketModel = null, session = null) {
  if (!eventId || !newEventEnd) return 0;
  const newEndDate = new Date(newEventEnd);
  if (!Number.isFinite(newEndDate.getTime())) return 0;

  const Ticket = TicketModel || require("../models/client/eventTicketType.schema");

  const excessQuery = Ticket.find({
    eventId,
    salesEndAt: { $gt: newEndDate },
  });

  const excessTickets = await (session ? excessQuery.session(session) : excessQuery);
  if (!excessTickets || excessTickets.length === 0) {
    return 0;
  }

  // Clamp salesEndAt to the new event end time
  await Ticket.updateMany(
    {
      eventId,
      salesEndAt: { $gt: newEndDate },
    },
    {
      $set: { salesEndAt: newEndDate },
    }, { session }
  );

  // Clamp salesStartAt if it exceeds the new end time
  await Ticket.updateMany(
    {
      eventId,
      salesStartAt: { $gt: newEndDate },
    },
    {
      $set: { salesStartAt: new Date(newEndDate.getTime() - 1) },
    }, { session }
  );

  return excessTickets.length;
}

module.exports = { salesWindowError, salesEndError, realignTicketSalesWindows };

