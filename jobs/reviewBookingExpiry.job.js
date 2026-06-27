const { CronJob } = require("cron");
const EventCenterBooking = require("../models/user/eventCenterBooking.schema");
const EventCenter = require("../models/user/eventCenter.schema");
const Notification = require("../models/user/notification.schema");
const { getPaymentGateway } = require("../services/payment");
const { logBookingHistory } = require("../controllers/user/bookingHistory.controller");

const gateway = getPaymentGateway();

let isRunning = false; // Concurrency guard

const expirePendingBookings = async () => {
  if (isRunning) {
    console.log("[Review Expiry] Previous run still in progress, skipping.");
    return;
  }
  isRunning = true;

  try {
    const now = new Date();

    // Find all bookings that are PENDING_REVIEW and past their review deadline
    const expiredBookings = await EventCenterBooking.find({
      status: "PENDING_REVIEW",
      reviewDeadline: { $lte: now },
    }).populate("eventCenter", "venueName");

    for (const ticket of expiredBookings) {
      try {
        // Atomic status transition: only process if still PENDING_REVIEW
        const updated = await EventCenterBooking.findOneAndUpdate(
          { _id: ticket._id, status: "PENDING_REVIEW" },
          {
            $set: {
              status: "CANCELLED",
              reviewedAt: now,
            },
          },
          { new: true },
        );

        if (!updated) {
          // Another process already handled this booking (accept/decline)
          console.log(`[Review Expiry] Booking ${ticket._id} already processed, skipping.`);
          continue;
        }

        // Refund payment if it was completed
        if (updated.paymentStatus === "COMPLETED" && updated.paymentReference) {
          try {
            await gateway.refundPayment(updated.paymentReference);
            updated.paymentStatus = "REFUNDED";
          } catch (refundErr) {
            console.error(`[Review Expiry] Refund failed for ticket ${updated._id}:`, refundErr.message);
            updated.paymentStatus = "FAILED_REFUND";
          }
          await updated.save();
        }

        // Remove date/slot blocks from EventCenter
        const ecDoc = await EventCenter.findById(updated.eventCenter);
        if (ecDoc?.availability) {
          const ticketIdStr = String(updated._id);

          if (updated.bookingUnit === "day" && ecDoc.availability.unavailableDates) {
            ecDoc.availability.unavailableDates =
              ecDoc.availability.unavailableDates.filter(
                (d) => String(d.bookingId) !== ticketIdStr
              );
          } else if (updated.bookingUnit === "hour" && ecDoc.availability.unavailableSlots) {
            ecDoc.availability.unavailableSlots =
              ecDoc.availability.unavailableSlots.filter(
                (s) => String(s.bookingId) !== ticketIdStr
              );
          }

          await ecDoc.save();
        }

        // Notify buyer
        const venueName = ticket.eventCenter?.venueName || "your venue";
        const refundNote = updated.paymentStatus === "REFUNDED" ? " A full refund has been issued." : "";
        await Notification.create({
          recipient: updated.buyer,
          type: "BOOKING_UPDATE",
          title: "Booking Expired",
          message: `Your booking at ${venueName} expired because the host did not respond in time.${refundNote}`,
          referenceId: updated._id,
        });

        // Notify organizer
        await Notification.create({
          recipient: updated.organiser,
          type: "BOOKING_UPDATE",
          title: "Booking Request Expired",
          message: `Booking request from ${updated.guestDetails?.fullName || "a guest"} for ${venueName} has expired.`,
          referenceId: updated._id,
        });

        // Log booking history
        logBookingHistory({
          eventCenter: updated.eventCenter._id || updated.eventCenter,
          ticket: updated._id,
          bookingId: String(updated._id),
          bookingType: "PLATFORM",
          bookingUnit: updated.bookingUnit,
          action: "CANCELLED",
          performedBy: null,
          dates: updated.selectedDates,
          guestName: updated.guestDetails?.fullName || "",
          totalPrice: updated.totalPrice,
          reason: "Review deadline expired",
        });

        console.log(`[Review Expiry] Expired booking ${updated._id} for venue ${venueName}`);
      } catch (err) {
        console.error(`[Review Expiry] Error processing ticket ${ticket._id}:`, err);
      }
    }

    if (expiredBookings.length > 0) {
      console.log(`[Review Expiry] Processed ${expiredBookings.length} expired booking(s)`);
    }
  } catch (error) {
    console.error("[CRON JOB ERROR - expirePendingBookings]", error);
  } finally {
    isRunning = false;
  }
};

// Run every 10 minutes
const job = new CronJob("*/10 * * * *", expirePendingBookings, null, true, "UTC");

console.log("[Cron Job] Review Booking Expiry Job scheduled to run every 10 minutes.");

module.exports = job;
