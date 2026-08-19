const { CronJob } = require("cron");
const Ticket = require("../models/user/eventTicketType.schema");
const Event = require("../models/user/event.schema");
const UserEventTicket = require("../models/user/userEventTicket.schema");
const EventCenterBooking = require("../models/user/eventCenterBooking.schema");
const Notification = require("../models/user/notification.schema");
const { dispatchNotification, dispatchBulkNotifications, NOTIFICATION_TYPES } = require("../services/notification");

let isRunning = false;

const runNotificationChecks = async () => {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    // ========================================================================
    // 1. Check upcoming ticket sales starting (within last 5 minutes)
    // ========================================================================
    const upcomingTickets = await Ticket.find({
      salesStartAt: { $lte: now },
    }).populate("eventId", "title createdBy");

    for (const ticket of upcomingTickets) {
      if (ticket.eventId?.createdBy) {
        const creatorId = ticket.eventId.createdBy;
        const exists = await Notification.findOne({
          recipient: creatorId,
          referenceId: ticket._id,
          type: NOTIFICATION_TYPES.TICKET_SALES_STARTED,
        });

        if (!exists) {
          await dispatchNotification({
            recipient: creatorId,
            type: NOTIFICATION_TYPES.TICKET_SALES_STARTED,
            title: "Ticket Sales Started 🚀",
            message: `Ticket sales for "${ticket.name}" (Event: "${ticket.eventId.title}") have officially started.`,
            referenceId: ticket._id,
            referenceType: "Event",
            data: { screen: "EventDetails", eventId: String(ticket.eventId._id) },
          });
        }
      }
    }

    // ========================================================================
    // 2. Check ended ticket sales
    // ========================================================================
    const endedTickets = await Ticket.find({
      salesEndAt: { $lte: now },
    }).populate("eventId", "title createdBy");

    for (const ticket of endedTickets) {
      if (ticket.eventId?.createdBy) {
        const creatorId = ticket.eventId.createdBy;
        const exists = await Notification.findOne({
          recipient: creatorId,
          referenceId: ticket._id,
          type: NOTIFICATION_TYPES.TICKET_SALES_ENDED,
        });

        if (!exists) {
          await dispatchNotification({
            recipient: creatorId,
            type: NOTIFICATION_TYPES.TICKET_SALES_ENDED,
            title: "Ticket Sales Ended",
            message: `Ticket sales for "${ticket.name}" (Event: "${ticket.eventId.title}") have ended.`,
            referenceId: ticket._id,
            referenceType: "Event",
            data: { screen: "EventDetails", eventId: String(ticket.eventId._id) },
          });
        }
      }
    }

    // ========================================================================
    // 3. Check 24-Hour Upcoming Event Reminders for Ticket Holders
    // ========================================================================
    const in24HoursStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const in24HoursEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const upcomingEvents24h = await Event.find({
      "schedule.from": { $gte: in24HoursStart, $lte: in24HoursEnd },
    }).select("title schedule venueName location");

    for (const event of upcomingEvents24h) {
      // Find active ticket holders
      const tickets = await UserEventTicket.find({
        eventId: event._id,
        status: { $in: ["UNREDEEMED", "CONFIRMED"] },
      }).select("owner").lean();

      const uniqueOwners = [...new Set(tickets.map((t) => String(t.owner)))];

      for (const ownerId of uniqueOwners) {
        const exists = await Notification.findOne({
          recipient: ownerId,
          referenceId: event._id,
          type: NOTIFICATION_TYPES.EVENT_REMINDER_24H,
        });

        if (!exists) {
          await dispatchNotification({
            recipient: ownerId,
            type: NOTIFICATION_TYPES.EVENT_REMINDER_24H,
            title: `Reminder: ${event.title} is tomorrow! ⏰`,
            message: `"${event.title}" starts in 24 hours at ${event.venueName || event.location?.name || "the venue"}. Have your tickets ready!`,
            referenceId: event._id,
            referenceType: "Event",
            data: { screen: "TicketDetails", eventId: String(event._id) },
          });
        }
      }
    }

    // ========================================================================
    // 4. Check 6-Hour Review Expiry Warning for Hosts
    // ========================================================================
    const in6Hours = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const pendingReviews = await EventCenterBooking.find({
      status: "PENDING_REVIEW",
      reviewDeadline: { $lte: in6Hours, $gt: now },
    }).populate("eventCenter", "venueName").lean();

    for (const booking of pendingReviews) {
      const exists = await Notification.findOne({
        recipient: booking.organiser,
        referenceId: booking._id,
        type: NOTIFICATION_TYPES.BOOKING_REVIEW_REMINDER,
      });

      if (!exists) {
        const venue = booking.eventCenter?.venueName || "your venue";
        await dispatchNotification({
          recipient: booking.organiser,
          type: NOTIFICATION_TYPES.BOOKING_REVIEW_REMINDER,
          title: "Booking Review Expiring Soon ⚠️",
          message: `Booking request for ${venue} expires in less than 6 hours. Please accept or decline now.`,
          referenceId: booking._id,
          referenceType: "EventCenterBooking",
          priority: "urgent",
          data: { screen: "BookingReview", ticketId: String(booking._id) },
        });
      }
    }

    // ========================================================================
    // 5. Check event completion
    // ========================================================================
    const completedEvents = await Event.find({
      "schedule.to": { $lte: now },
    }).select("title createdBy");

    for (const event of completedEvents) {
      if (event.createdBy) {
        const creatorId = event.createdBy;
        const exists = await Notification.findOne({
          recipient: creatorId,
          referenceId: event._id,
          type: NOTIFICATION_TYPES.EVENT_COMPLETED,
        });

        if (!exists) {
          await dispatchNotification({
            recipient: creatorId,
            type: NOTIFICATION_TYPES.EVENT_COMPLETED,
            title: "Event Completed 🌟",
            message: `Your event "${event.title}" has ended. View your dashboard for wrap-up analytics.`,
            referenceId: event._id,
            referenceType: "Event",
            data: { screen: "EventAnalytics", eventId: String(event._id) },
          });
        }
      }
    }
  } catch (error) {
    console.error("[CRON JOB ERROR - runNotificationChecks]", error);
  } finally {
    isRunning = false;
  }
};

// Run every 2 minutes
const job = new CronJob("*/2 * * * *", runNotificationChecks, null, true, "UTC");

console.log("[Cron Job] Enhanced Notification Trigger Job scheduled to run every 2 minutes.");

module.exports = job;
