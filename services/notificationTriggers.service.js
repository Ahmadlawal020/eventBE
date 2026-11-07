const mongoose = require("mongoose");
const Event = require("../models/client/event.schema"), Tier = require("../models/client/eventTicketType.schema");
const Ticket = require("../models/client/userEventTicket.schema"), Booking = require("../models/client/eventCenterBooking.schema");
const Notice = require("../models/client/notification.schema");
const { queueNotices } = require("./eventCenterRefundNotifications.service");
const checkpoints = () => mongoose.connection.collection("worker_scan_checkpoints");
async function page(name, model, filter, select, populate) {
  const checkpoint = await checkpoints().findOne({ _id: name });
  let query = model.find({ ...filter, ...(checkpoint?.cursor ? { _id: { $gt: checkpoint.cursor } } : {}) }).sort({ _id: 1 }).limit(100).select(select);
  if (populate) query = query.populate(...populate);
  const rows = await query.lean();
  return { rows, commit: () => checkpoints().updateOne({ _id: name }, { $set: { cursor: rows.length === 100 ? rows[rows.length - 1]._id : null } }, { upsert: true }) };
}
async function queue(reference, recipient, type, title, message, data, occurrence = 0) {
  // Honor notifications already delivered before the outbox migration.
  if (occurrence === 0 && await Notice.exists({ recipient, referenceId: reference, type })) return;
  await queueNotices([{ key: `trigger:${reference}:${recipient}:${type}:${occurrence}`, recipient, type, title, message, data, channels: require("../constants/notificationTypes").TYPE_CONFIG[type]?.defaultChannels || ["in_app", "push"] }]);
}
async function runNotificationChecks() {
  const now = new Date(); let processed = 0;
  for (const [field, type, label] of [["salesStartAt", "TICKET_SALES_STARTED", "started"], ["salesEndAt", "TICKET_SALES_ENDED", "ended"]]) {
    const batch = await page(type, Tier, { [field]: { $lte: now } }, "name eventId", ["eventId", "title createdBy occurrence status"]);
    for (const tier of batch.rows) if (tier.eventId?.createdBy && ["LISTED", "UNLISTED"].includes(tier.eventId.status)) {
      await queue(tier._id, tier.eventId.createdBy, type, "Ticket sales " + label, `Sales for ${tier.name} (${tier.eventId.title}) have ${label}.`, { screen: "EventDetails", eventId: String(tier.eventId._id) }, tier.eventId.occurrence || 0); processed++;
    }
    await batch.commit();
  }
  const upcoming = await page("event-reminders", Event, { status: "LISTED", "schedule.from": { $gt: now, $lte: new Date(+now + 24 * 3600000) } }, "title schedule venueName occurrence");
  for (const event of upcoming.rows) {
    const cursor = Ticket.find({ eventId: event._id, status: "UNREDEEMED", occurrence: event.occurrence || 0, refundHold: { $ne: true } }).select("owner").lean().cursor();
    for await (const ticket of cursor) { await queue(event._id, ticket.owner, "EVENT_REMINDER_24H", "Upcoming event", `${event.title} starts within 24 hours. Open your ticket for its schedule.`, { screen: "Tickets", eventId: String(event._id) }, event.occurrence || 0); processed++; }
  }
  await upcoming.commit();
  const review = await page("review-reminders", Booking, { status: "PENDING_REVIEW", reviewDeadline: { $gt: now, $lte: new Date(+now + 6 * 3600000) } }, "organiser eventCenter reviewDeadline");
  for (const booking of review.rows) { await queue(booking._id, booking.organiser, "BOOKING_REVIEW_REMINDER", "Booking review expires soon", "Accept or decline this booking before " + booking.reviewDeadline.toISOString(), { screen: "BookingReview", ticketId: String(booking._id) }); processed++; }
  await review.commit();
  const completed = await page("completed-notices", Event, { status: "COMPLETED" }, "title createdBy occurrence");
  for (const event of completed.rows) { await queue(event._id, event.createdBy, "EVENT_COMPLETED", "Event completed", `${event.title} has ended. View your dashboard for analytics.`, { screen: "EventAnalytics", eventId: String(event._id) }, event.occurrence || 0); processed++; }
  await completed.commit();
  return { processed };
}
module.exports = { runNotificationChecks };
