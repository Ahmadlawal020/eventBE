const { randomUUID } = require("crypto");
const Outbox = require("../models/client/notificationOutbox.schema");
const Notification = require("../models/client/notification.schema");
const User = require("../models/client/user.schema");
const { sendEmail } = require("./email.service");
const { generalNotificationTemplate } = require("./notification/emailTemplates");
const { TYPE_CONFIG, NOTIFICATION_CATEGORIES } = require("../constants/notificationTypes");

async function queueNotices(notices, session) {
  if (!notices.length) return;
  await Outbox.bulkWrite(notices.map(notice => ({
    updateOne: { filter: { key: notice.key }, update: { $setOnInsert: {
      ...notice, completedAt: null, attempts: 0, nextAttemptAt: new Date(), lockedUntil: new Date(0),
    } }, upsert: true },
  })), { session });
}

function cancellationNotices(event, recipients) {
  return [...new Set(recipients.map(String))].map(recipient => ({
    key: `event-cancelled:${event._id}:${recipient}`,
    recipient, sender: event.createdBy, type: "EVENT_CANCELLED",
    title: `Event cancelled: ${event.title}`,
    message: `"${event.title}" has been cancelled. Entry is closed. ${event.lifecycle?.cancellationMessage || ""} Open your ticket to see any refund owed to its current holder.`,
    data: { eventId: String(event._id), screen: "Tickets" },
  }));
}

// Each channel is persisted separately. Retrying email cannot duplicate the in-app notice.
async function deliverNotice(notice, token) {
  const filter = { _id: notice._id, lockToken: token };
  const user = await User.findById(notice.recipient).select("firstName email").lean();
  if (!user) throw new Error("Notification recipient no longer exists");
  if (!notice.inAppSentAt) {
    await Notification.updateOne({ _id: notice._id }, { $setOnInsert: {
      recipient: notice.recipient, sender: notice.sender, type: notice.type,
      category: TYPE_CONFIG[notice.type]?.category || NOTIFICATION_CATEGORIES.SYSTEM,
      title: notice.title, message: notice.message, priority: "urgent",
      data: { ...notice.data, type: notice.type },
    } }, { upsert: true, runValidators: true });
    await Outbox.updateOne(filter, { $set: { inAppSentAt: new Date() } });
  }
  if (!notice.emailSentAt) {
    if (!user.email) throw new Error("Notification recipient has no email address");
    const result = await sendEmail({
      to: user.email, subject: notice.title,
      html: generalNotificationTemplate({ recipientName: user.firstName, title: notice.title, message: notice.message }),
      idempotencyKey: `refund-notice/${notice._id}`,
    });
    if (!result?.id) throw new Error("Email provider is not configured or did not accept the email");
    await Outbox.updateOne(filter, { $set: { emailSentAt: new Date() } });
  }
  await Outbox.updateOne(filter, { $set: { completedAt: new Date(), lastError: null, lockedUntil: new Date(0) } });
}

async function processRefundNotices({ limit = 25, delayMs = 600 } = {}) {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const token = randomUUID();
    const notice = await Outbox.findOneAndUpdate({
      completedAt: null, nextAttemptAt: { $lte: now }, lockedUntil: { $lte: now },
    }, { $set: { lockToken: token, lockedUntil: new Date(Date.now() + 5 * 60000) }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1 } });
    if (!notice) break;
    try { await deliverNotice(notice, token); }
    catch (error) {
      await Outbox.updateOne({ _id: notice._id, lockToken: token }, { $set: {
        lastError: String(error.message).slice(0, 500), lockedUntil: new Date(0),
        nextAttemptAt: new Date(Date.now() + Math.min(86400000, 60000 * 2 ** Math.min(notice.attempts, 10))),
      } });
      console.error("[REFUND NOTICE RETRY]", String(notice._id), error.message);
    }
    processed++;
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return processed;
}
module.exports = { queueNotices, cancellationNotices, processRefundNotices, deliverNotice };
