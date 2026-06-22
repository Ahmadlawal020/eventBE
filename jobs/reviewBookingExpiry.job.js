const { CronJob } = require("cron");
const EventCenterBooking = require("../models/user/eventCenterBooking.schema");
const EventCenter = require("../models/user/eventCenter.schema");
const Notification = require("../models/user/notification.schema");
const { getPaymentGateway } = require("../services/payment");
const { logBookingHistory } = require("../controllers/user/bookingHistory.controller");

const gateway = getPaymentGateway();

const expirePendingBookings = async () => {
  try {
    const now = new Date();

    // Find all bookings that are PENDING_REVIEW and past their review deadline
    const expiredBookings = await EventCenterBooking.find({
      status: "PENDING_REVIEW",
      reviewDeadline: { $lte: now },
    }).populate("eventCenter", "venueName");

    for (const ticket of expiredBookings) {
      try {
        // Refund payment if it was completed
        if (ticket.paymentStatus === "COMPLETED" && ticket.paymentReference) {
          try {
            await gateway.refundPayment(ticket.paymentReference);
            ticket.paymentStatus = "REFUNDED";
          } catch (refundErr) {
            console.error(`[Review Expiry] Refund failed for ticket ${ticket._id}:`, refundErr.message);
          }
        }

        ticket.status = "CANCELLED";
        ticket.reviewedAt = now;
        await ticket.save();

        // Remove date/slot blocks from EventCenter
        const ecDoc = await EventCenter.findById(ticket.eventCenter);
        if (ecDoc?.availability) {
          const ticketIdStr = String(ticket._id);

          if (ticket.bookingUnit === "day" && ecDoc.availability.unavailableDates) {
            ecDoc.availability.unavailableDates =
              ecDoc.availability.unavailableDates.filter(
                (d) => String(d.bookingId) !== ticketIdStr
              );
          } else if (ticket.bookingUnit === "hour" && ecDoc.availability.unavailableSlots) {
            ecDoc.availability.unavailableSlots =
              ecDoc.availability.unavailableSlots.filter(
                (s) => String(s.bookingId) !== ticketIdStr
              );
          }

          await ecDoc.save();
        }

        // Notify buyer
        const venueName = ticket.eventCenter?.venueName || "your venue";
        const refundNote = ticket.paymentStatus === "REFUNDED" ? " A full refund has been issued." : "";
        await Notification.create({
          recipient: ticket.buyer,
          type: "BOOKING_UPDATE",
          title: "Booking Expired",
          message: `Your booking at ${venueName} expired because the host did not respond in time.${refundNote}`,
          referenceId: ticket._id,
        });

        // Notify organizer
        await Notification.create({
          recipient: ticket.organiser,
          type: "BOOKING_UPDATE",
          title: "Booking Request Expired",
          message: `Booking request from ${ticket.guestDetails?.fullName || "a guest"} for ${venueName} has expired.`,
          referenceId: ticket._id,
        });

        // Log booking history
        logBookingHistory({
          eventCenter: ticket.eventCenter._id || ticket.eventCenter,
          ticket: ticket._id,
          bookingId: String(ticket._id),
          bookingType: "PLATFORM",
          action: "CANCELLED",
          performedBy: null,
          dates: ticket.selectedDates,
          guestName: ticket.guestDetails?.fullName || "",
          totalPrice: ticket.totalPrice,
          reason: "Review deadline expired",
        });

        console.log(`[Review Expiry] Expired booking ${ticket._id} for venue ${venueName}`);
      } catch (err) {
        console.error(`[Review Expiry] Error processing ticket ${ticket._id}:`, err);
      }
    }

    if (expiredBookings.length > 0) {
      console.log(`[Review Expiry] Processed ${expiredBookings.length} expired booking(s)`);
    }
  } catch (error) {
    console.error("[CRON JOB ERROR - expirePendingBookings]", error);
  }
};

// Run every 10 minutes
const job = new CronJob("*/10 * * * *", expirePendingBookings, null, true, "UTC");

console.log("[Cron Job] Review Booking Expiry Job scheduled to run every 10 minutes.");

module.exports = job;
