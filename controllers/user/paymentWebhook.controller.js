const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const EventBooking = require("../../models/user/eventBooking.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const User = require("../../models/user/user.schema");
const Notification = require("../../models/user/notification.schema");
const { generateTicketNumber, generateQRPayload } = require("../../utils/qr");
const { hasSlotConflict } = require("../../utils/slotConflict");
const { logBookingHistory } = require("./bookingHistory.controller");
const { getPaymentGateway } = require("../../services/payment");
const { createTicketsForBooking } = require("./userEventTicket.controller");

const gateway = getPaymentGateway();

// ============================================================================
// EVENT TICKET BOOKING WEBHOOK HANDLER
// ============================================================================

const handleEventTicketWebhook = async (reference, metadata, customer) => {
  const { eventId, buyerId, items, totalAmount, fullName, phoneNumber } = metadata;

  // 1. Idempotency: check if booking already exists and is completed
  const existingBooking = await EventBooking.findOne({ paymentReference: reference });
  if (existingBooking && existingBooking.paymentStatus === "COMPLETED") {
    console.log(`[WEBHOOK] Event ticket booking already completed for ref ${reference}`);
    return;
  }

  // 2. Create or update booking
  let booking;
  if (existingBooking) {
    existingBooking.paymentStatus = "COMPLETED";
    booking = await existingBooking.save();
  } else {
    try {
      booking = await EventBooking.create({
        eventId,
        buyer: buyerId,
        guestDetails: {
          fullName: fullName || "",
          phoneNumber: phoneNumber || "",
          email: customer?.email || "",
        },
        items: items || [],
        totalAmount: totalAmount || 0,
        paymentMethod: "CARD",
        paymentReference: reference,
        paymentStatus: "COMPLETED",
      });
    } catch (err) {
      if (err.code === 11000) {
        // Duplicate key race condition — fetch existing
        booking = await EventBooking.findOne({ paymentReference: reference });
        if (booking && booking.paymentStatus !== "COMPLETED") {
          booking.paymentStatus = "COMPLETED";
          booking = await booking.save();
        }
      } else {
        throw err;
      }
    }
  }

  // 3. Generate individual tickets (idempotent — skip if tickets already exist)
  if (booking) {
    const UserEventTicket = require("../../models/user/userEventTicket.schema");
    const existingTickets = await UserEventTicket.find({ bookingId: booking._id }).lean();
    if (existingTickets.length === 0) {
      await createTicketsForBooking(booking);
    }
    console.log(`[WEBHOOK] Tickets generated for event booking ref ${reference}`);
  }
};

// ============================================================================
// GENERIC PAYMENT WEBHOOK HANDLER
// ============================================================================

const handlePaymentWebhook = async (req, res) => {
  // 1. Validate signature using gateway adapter
  if (!gateway.validateWebhookSignature(req.rawBody, req.headers)) {
    console.warn(`[${gateway.name.toUpperCase()} WEBHOOK] Invalid signature`);
    return res.status(400).send("Invalid signature");
  }

  // 2. Parse and normalize event
  const normalizedEvent = gateway.parseWebhookEvent(req.body);

  if (normalizedEvent.event !== "charge.success") {
    return res.status(200).send("Ignored event");
  }

  if (normalizedEvent.status !== "success") {
    return res.status(200).send("Transaction not successful");
  }

  const { reference, metadata, customer } = normalizedEvent;

  // 3. Route to the correct handler based on booking type
  if (metadata?.type === "EVENT_TICKET") {
    try {
      await handleEventTicketWebhook(reference, metadata, customer);
      return res.status(200).send("OK");
    } catch (err) {
      console.error(`[EVENT_TICKET WEBHOOK ERROR]`, err);
      return res.status(500).send("Internal error");
    }
  }

  if (metadata?.type !== "EVENT_CENTER") {
    return res.status(200).send("Unknown booking type");
  }

  try {
    // 4. Idempotency: check if ticket already exists
    const existing = await EventCenterBooking.findOne({
      paymentReference: reference,
    });

    if (existing && existing.paymentStatus === "COMPLETED") {
      console.log(`[${gateway.name.toUpperCase()} WEBHOOK] Ticket already exists for ref ${reference}`);
      return res.status(200).send("Already processed");
    }

    const {
      eventCenterId,
      organiserId,
      buyerId,
      selectedDates,
      bookingUnit,
      duration,
      totalPrice,
      fullName,
      phoneNumber,
    } = metadata;

    // 5. Determine booking mode from event center settings
    const eventCenter = await EventCenter.findById(eventCenterId).select("bookingSettings venueName").lean();
    const isReviewMode = eventCenter?.bookingSettings === "REVIEW" || metadata.bookingMode === "REVIEW";

    // 6. Create or update ticket
    let ticket;

    if (existing) {
      existing.paymentStatus = "COMPLETED";
      if (isReviewMode) {
        existing.status = "PENDING_REVIEW";
        existing.bookingMode = "REVIEW";
        existing.reviewDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
      } else {
        if (!existing.ticketNumber) {
          existing.ticketNumber = generateTicketNumber("MNS");
          existing.qrPayload = generateQRPayload(existing.ticketNumber, eventCenterId, "EVENT_CENTER");
        }
      }
      ticket = await existing.save();
    } else {
      try {
        const ticketData = {
          buyer: buyerId,
          organiser: organiserId,
          eventCenter: eventCenterId,
          guestDetails: {
            fullName: fullName || "",
            phoneNumber: phoneNumber || "",
            email: customer?.email || "",
          },
          selectedDates,
          bookingUnit,
          duration,
          totalPrice,
          paymentReference: reference,
          paymentStatus: "COMPLETED",
        };

        if (isReviewMode) {
          ticketData.status = "PENDING_REVIEW";
          ticketData.bookingMode = "REVIEW";
          ticketData.reviewDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
        } else {
          ticketData.ticketNumber = generateTicketNumber("MNS");
          ticketData.qrPayload = generateQRPayload(ticketData.ticketNumber, eventCenterId, "EVENT_CENTER");
        }

        ticket = await EventCenterBooking.create(ticketData);
      } catch (err) {
        // E11000 = duplicate key (race with client verify or duplicate webhook)
        if (err.code === 11000) {
          console.log(`[${gateway.name.toUpperCase()} WEBHOOK] Duplicate key for ref ${reference}, fetching existing`);
          ticket = await EventCenterBooking.findOne({ paymentReference: reference });
          if (ticket && ticket.paymentStatus !== "COMPLETED") {
            ticket.paymentStatus = "COMPLETED";
            if (isReviewMode) {
              ticket.status = "PENDING_REVIEW";
              ticket.bookingMode = "REVIEW";
              ticket.reviewDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
            } else {
              if (!ticket.ticketNumber) {
                ticket.ticketNumber = generateTicketNumber("MNS");
                ticket.qrPayload = generateQRPayload(ticket.ticketNumber, eventCenterId, "EVENT_CENTER");
              }
            }
            ticket = await ticket.save();
          }
        } else {
          throw err;
        }
      }
    }

    // 7. Mark dates/slots unavailable on EventCenter (both INSTANT and REVIEW modes)
    if (ticket) {
      const ec = await EventCenter.findById(ticket.eventCenter);
      if (ec) {
        if (!ec.availability) {
          ec.availability = { unavailableDates: [], unavailableSlots: [] };
        }

        if (ticket.bookingUnit === "day") {
          const datesToMark = (ticket.selectedDates || []).map(
            (d) => new Date(d.date).toISOString().split("T")[0]
          );
          const currentStrings = (ec.availability.unavailableDates || []).map(
            (d) => new Date(d.date).toISOString().split("T")[0]
          );
          const newDateStrings = datesToMark.filter((d) => !currentStrings.includes(d));

          newDateStrings.forEach((dateStr) => {
            ec.availability.unavailableDates.push({
              date: new Date(dateStr),
              type: "BOOKED",
              bookingId: String(ticket._id),
              clientName: fullName || ticket.guestDetails?.fullName || "",
              clientPhone: phoneNumber || ticket.guestDetails?.phoneNumber || "",
              clientEmail: ticket.guestDetails?.email || customer?.email || "",
            });
          });
        } else if (ticket.bookingUnit === "hour") {
          const existingSlots = ec.availability.unavailableSlots || [];
          const conflictingSlots = (ticket.selectedDates || []).filter((slot) =>
            hasSlotConflict(slot, existingSlots, null)
          );

          if (conflictingSlots.length === 0) {
            const newSlots = (ticket.selectedDates || []).map((slot) => ({
              date: new Date(slot.date),
              startTime: slot.startTime,
              endTime: slot.endTime,
              type: "BOOKED",
              bookingId: String(ticket._id),
              clientName: fullName || ticket.guestDetails?.fullName || "",
              clientPhone: phoneNumber || ticket.guestDetails?.phoneNumber || "",
              clientEmail: ticket.guestDetails?.email || customer?.email || "",
            }));

            if (!ec.availability.unavailableSlots) {
              ec.availability.unavailableSlots = [];
            }
            ec.availability.unavailableSlots.push(...newSlots);
          } else {
            console.warn(`[${gateway.name.toUpperCase()} WEBHOOK] Slot conflict for ref ${reference}, skipping availability update`);
          }
        }

        await ec.save();
      }
    }

    // 8. Send notifications
    const guestName = fullName || ticket.guestDetails?.fullName || "A guest";
    const venueName = eventCenter?.venueName || "your venue";

    if (isReviewMode) {
      await Notification.create({
        recipient: organiserId,
        sender: buyerId,
        type: "BOOKING_UPDATE",
        title: "New Booking Request",
        message: `${guestName} requested to book ${venueName}. Review within 24 hours.`,
        referenceId: ticket._id,
      });
    } else {
      await Notification.create({
        recipient: organiserId,
        sender: buyerId,
        type: "BOOKING_UPDATE",
        title: "New Booking!",
        message: `${guestName} booked ${venueName}.`,
        referenceId: ticket._id,
      });
    }

    // Log booking history
    logBookingHistory({
      eventCenter: ticket.eventCenter,
      ticket: ticket._id,
      bookingId: String(ticket._id),
      bookingType: "PLATFORM",
      action: "CREATED",
      performedBy: buyerId,
      dates: ticket.selectedDates,
      guestName: fullName || ticket.guestDetails?.fullName || "",
      totalPrice: ticket.totalPrice,
    });

    console.log(`[${gateway.name.toUpperCase()} WEBHOOK] Successfully processed ref ${reference} (mode: ${isReviewMode ? "REVIEW" : "INSTANT"})`);
    return res.status(200).send("OK");
  } catch (err) {
    console.error(`[${gateway.name.toUpperCase()} WEBHOOK ERROR]`, err);
    return res.status(500).send("Internal error");
  }
};

module.exports = { handlePaymentWebhook };
