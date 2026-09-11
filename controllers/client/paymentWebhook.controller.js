const { recordBookingReferral } = require("../../services/referral.service");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const Event = require("../../models/client/event.schema");
const User = require("../../models/client/user.schema");
const {
  notifyTicketPurchased,
  notifyVenueBookingRequest,
  notifyVenueBookingInstant,
} = require("../../services/notification");
const { generateTicketNumber, generateQRPayload } = require("../../utils/qr");
const { hasSlotConflict } = require("../../utils/slotConflict");
const { logBookingHistory } = require("./bookingHistory.controller");
const { getPaymentGateway } = require("../../services/payment");
const { createTicketsForBooking } = require("./userEventTicket.controller");

const gateway = getPaymentGateway();

// ============================================================================
// EVENT TICKET BOOKING WEBHOOK HANDLER
// ============================================================================

const handleEventTicketWebhook = async (reference, metadata, customer, paidAt, paidAmount) => {
  const {
    eventId,
    buyerId,
    items,
    totalAmount,
    subtotalAmount,
    platformFeeAmount,
    buyerFeeAmount,
    organiserFeeAmount,
    organiserPayoutAmount,
    feePercentage,
    feeMode,
    fixedFeeAmount,
    fullName,
    phoneNumber,
  } = metadata;

  if (
    Number.isFinite(Number(paidAmount)) &&
    Math.round(Number(paidAmount) * 100) !== Math.round(Number(totalAmount))
  ) {
    throw new Error(`Paid amount does not match event ticket booking ${reference}`);
  }

  // 1. Idempotency: check if booking already exists and is completed
  const existingBooking = await EventBooking.findOne({ paymentReference: reference });
  if (existingBooking && existingBooking.paymentStatus === "COMPLETED") {
    await recordBookingReferral(existingBooking._id, "EVENT_TICKET");
    console.log(`[WEBHOOK] Event ticket booking already completed for ref ${reference}`);
    return;
  }

  // 2. Create or update booking
  let booking;
  if (existingBooking) {
    existingBooking.referralPaymentAt = paidAt || new Date();
    existingBooking.paymentStatus = "COMPLETED";
    booking = await existingBooking.save();
  } else {
    try {
      const formattedItems = (items || []).map((item) => ({
        ticketId: item.ticketId || item.ticketTypeId,
        name: item.name || "Event Ticket",
        quantity: Number(item.quantity || 1),
        pricePerUnit: Number(item.pricePerUnit !== undefined ? item.pricePerUnit : (item.price || 0)),
        totalPrice: Number(item.totalPrice !== undefined ? item.totalPrice : (item.price || 0) * (item.quantity || 1)),
        subtotalAmount: Number(item.subtotalAmount ?? item.totalPrice ?? 0),
        feeMode: item.feeMode,
        feeAmount: Number(item.feeAmount || 0),
        buyerFeeAmount: Number(item.buyerFeeAmount || 0),
        organiserFeeAmount: Number(item.organiserFeeAmount || 0),
      }));

      booking = await EventBooking.create({
        eventId,
        buyer: buyerId,
        guestDetails: {
          fullName: fullName || "",
          phoneNumber: phoneNumber || "",
          email: customer?.email || "",
        },
        items: formattedItems,
        totalAmount: totalAmount || 0,
        subtotalAmount,
        platformFeeAmount,
        buyerFeeAmount,
        organiserFeeAmount,
        organiserPayoutAmount,
        feePercentage,
        feeMode,
        fixedFeeAmount,
        paymentMethod: "CARD",
        paymentReference: reference,
        paymentStatus: "COMPLETED",
        referralPaymentAt: paidAt || new Date(),
      });
    } catch (err) {
      if (err.code === 11000) {
        // Duplicate key race condition — fetch existing
        booking = await EventBooking.findOne({ paymentReference: reference });
        if (booking && booking.paymentStatus !== "COMPLETED") {
          booking.referralPaymentAt = paidAt || new Date();
          booking.paymentStatus = "COMPLETED";
          booking = await booking.save();
        }
      } else {
        throw err;
      }
    }
  }

  if (booking) await recordBookingReferral(booking._id, "EVENT_TICKET");

  // 3. Generate individual tickets (idempotent — skip if tickets already exist)
  if (booking) {
    const UserEventTicket = require("../../models/client/userEventTicket.schema");
    const existingTickets = await UserEventTicket.find({ bookingId: booking._id }).lean();
    if (existingTickets.length === 0) {
      await createTicketsForBooking(booking);
    }
    console.log(`[WEBHOOK] Tickets generated for event booking ref ${reference}`);

    // 4. Dispatch Notifications & Confirmation Emails
    try {
      const eventDoc = await Event.findById(eventId).select("title schedule location venueName createdBy").lean();
      await notifyTicketPurchased({
        booking,
        event: eventDoc,
        buyer: { _id: buyerId, fullName, email: customer?.email },
        reference,
      });

    } catch (notifErr) {
      console.error("[WEBHOOK] Error dispatching event ticket notifications / referral commission:", notifErr);
    }
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

  const { reference, metadata, customer, paidAt, amount } = normalizedEvent;

  // 3. Route to the correct handler based on booking type
  if (metadata?.type === "EVENT_TICKET") {
    try {
      await handleEventTicketWebhook(reference, metadata, customer, paidAt, amount);
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
      await recordBookingReferral(existing._id, "EVENT_CENTER_BOOKING");
      console.log(`[${gateway.name.toUpperCase()} WEBHOOK] Ticket already exists for ref ${reference}`);
      return res.status(200).send("Already processed");
    }

    if (!metadata.eventCenterId || !metadata.organiserId || !metadata.buyerId) {
      console.error(`[WEBHOOK] Missing required metadata for ref ${reference}:`, JSON.stringify(metadata));
      return res.status(400).send("Incomplete metadata");
    }

    const {
      eventCenterId,
      organiserId,
      buyerId,
      selectedDates,
      bookingUnit,
      duration,
      totalPrice,
      subtotalPrice,
      platformFeeAmount,
      buyerFeeAmount,
      organiserFeeAmount,
      organiserPayoutAmount,
      feePercentage,
      feeMode,
      fullName,
      phoneNumber,
    } = metadata;

    if (
      Number.isFinite(Number(amount)) &&
      Math.round(Number(amount) * 100) !==
        Math.round(Number(totalPrice?.amount || 0) * 100)
    ) {
      return res.status(400).send("Payment amount mismatch");
    }

    // 5. Determine booking mode from event center settings
    const eventCenter = await EventCenter.findById(eventCenterId).select("bookingSettings venueName").lean();
    const isReviewMode = eventCenter?.bookingSettings === "REVIEW" || metadata.bookingMode === "REVIEW";

    // 6. Create or update ticket
    let ticket;

    if (existing) {
      existing.referralPaymentAt = paidAt || new Date();
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
          subtotalPrice,
          platformFeeAmount,
          buyerFeeAmount,
          organiserFeeAmount,
          organiserPayoutAmount,
          feePercentage,
          feeMode,
          paymentReference: reference,
          paymentStatus: "COMPLETED",
          referralPaymentAt: paidAt || new Date(),
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
            ticket.referralPaymentAt = paidAt || new Date();
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

    if (ticket) await recordBookingReferral(ticket._id, "EVENT_CENTER_BOOKING");

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

    // 8. Send notifications via Notification Engine
    const guestName = fullName || ticket.guestDetails?.fullName || "A guest";

    if (isReviewMode) {
      await notifyVenueBookingRequest({
        booking: ticket,
        eventCenter,
        guestName,
        buyerId,
        organiserId,
      });
    } else {
      await notifyVenueBookingInstant({
        booking: ticket,
        eventCenter,
        guestName,
        buyerId,
        organiserId,
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
