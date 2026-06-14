const { CronJob } = require("cron");
const Ticket = require("../models/user/eventTicket.schema");
const Event = require("../models/user/event.schema");
const Notification = require("../models/user/notification.schema");

const runNotificationChecks = async () => {
  try {
    const now = new Date();

    // 1. Check upcoming ticket sales starting
    const upcomingTickets = await Ticket.find({
      salesStartAt: { $lte: now },
    }).populate("eventId");

    for (const ticket of upcomingTickets) {
      if (ticket.eventId && ticket.eventId.createdBy) {
        const creatorId = ticket.eventId.createdBy;
        // Check if notification already sent
        const exists = await Notification.findOne({
          recipient: creatorId,
          referenceId: ticket._id,
          title: "Ticket Sales Started",
        });

        if (!exists) {
          await Notification.create({
            recipient: creatorId,
            type: "SYSTEM",
            title: "Ticket Sales Started",
            message: `Ticket sales for "${ticket.name}" (Event: "${ticket.eventId.title}") have started.`,
            referenceId: ticket._id,
          });
          console.log(`[Cron Job] Sent sale start notification for ticket "${ticket.name}" to ${creatorId}`);
        }
      }
    }

    // 2. Check ended ticket sales
    const endedTickets = await Ticket.find({
      salesEndAt: { $lte: now },
    }).populate("eventId");

    for (const ticket of endedTickets) {
      if (ticket.eventId && ticket.eventId.createdBy) {
        const creatorId = ticket.eventId.createdBy;
        // Check if notification already sent
        const exists = await Notification.findOne({
          recipient: creatorId,
          referenceId: ticket._id,
          title: "Ticket Sales Ended",
        });

        if (!exists) {
          await Notification.create({
            recipient: creatorId,
            type: "SYSTEM",
            title: "Ticket Sales Ended",
            message: `Ticket sales for "${ticket.name}" (Event: "${ticket.eventId.title}") have ended.`,
            referenceId: ticket._id,
          });
          console.log(`[Cron Job] Sent sale end notification for ticket "${ticket.name}" to ${creatorId}`);
        }
      }
    }

    // 3. Check event completion
    const completedEvents = await Event.find({
      "schedule.to": { $lte: now },
    });

    for (const event of completedEvents) {
      if (event.createdBy) {
        const creatorId = event.createdBy;
        // Check if notification already sent
        const exists = await Notification.findOne({
          recipient: creatorId,
          referenceId: event._id,
          title: "Event Completed",
        });

        if (!exists) {
          await Notification.create({
            recipient: creatorId,
            type: "SYSTEM",
            title: "Event Completed",
            message: `Your event "${event.title}" has ended.`,
            referenceId: event._id,
          });
          console.log(`[Cron Job] Sent event completed notification for event "${event.title}" to ${creatorId}`);
        }
      }
    }
  } catch (error) {
    console.error("[CRON JOB ERROR - runNotificationChecks]", error);
  }
};

// Run every minute
const job = new CronJob("*/1 * * * *", runNotificationChecks, null, true, "UTC");

console.log("[Cron Job] Notification Trigger Job scheduled to run every minute.");

module.exports = job;
