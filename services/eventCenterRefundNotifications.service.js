const { randomUUID } = require("crypto");
const Outbox = require("../models/client/eventCenterRefundOutbox.schema");
const Notification = require("../models/client/notification.schema");
const User = require("../models/client/user.schema");
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

// Each channel is persisted separately. Retrying email cannot duplicate the in-app notice.
async function deliverNotice(notice, token) {
  const filter = { _id: notice._id, lockToken: token };
  const user = await User.findById(notice.recipient).select("firstName email pushTokens notificationPreferences").lean();
  if (!user) throw Object.assign(new Error("Notification recipient no longer exists"), { permanent: true });
  if (!notice.inAppSentAt) {
    await Notification.updateOne({ _id: notice._id }, { $setOnInsert: {
      recipient: notice.recipient, sender: notice.sender, type: notice.type,
      category: TYPE_CONFIG[notice.type]?.category || NOTIFICATION_CATEGORIES.SYSTEM,
      title: notice.title, message: notice.message, priority: TYPE_CONFIG[notice.type]?.priority || "urgent",
      data: { ...notice.data, type: notice.type },
    } }, { upsert: true, runValidators: true });
    await Outbox.updateOne(filter, { $set: { inAppSentAt: new Date() } });
  }
  const category = TYPE_CONFIG[notice.type]?.category || NOTIFICATION_CATEGORIES.SYSTEM;
  const enabled = channel => (!notice.channels || notice.channels.includes(channel)) && require("./notification").isChannelEnabled(user.notificationPreferences, category, channel);
  let pushFailure = false;
  if (!notice.pushSentAt) {
    if (enabled("push")) for (const tokenValue of [...new Set((user.pushTokens || []).map(t => t.token))]) {
      const tokenHash = require("crypto").createHash("sha256").update(tokenValue).digest("hex");
      if (notice.pushDelivered?.includes(tokenHash)) continue;
      const result = await require("./notification/push.service").sendPushNotifications({ tokens: [tokenValue], title: notice.title,
        body: notice.message, data: { ...notice.data, type: notice.type, notificationId: String(notice._id) } });
      if (result.invalidTokens?.includes(tokenValue)) await User.updateOne({ _id: notice.recipient }, { $pull: { pushTokens: { token: tokenValue } } });
      if (result.successCount || result.invalidTokens?.includes(tokenValue)) await Outbox.updateOne(filter, { $addToSet: { pushDelivered: tokenHash } });
      else pushFailure = true;
    }
    if (!pushFailure) await Outbox.updateOne(filter, { $set: { pushSentAt: new Date() } });
  }
  if (!notice.emailSentAt && !enabled("email")) await Outbox.updateOne(filter, { $set: { emailSentAt: new Date() } });
  if (!notice.emailSentAt && enabled("email")) {
    if (!user.email) throw Object.assign(new Error("Notification recipient has no email address"), { permanent: true });
    const result = await require("./email.service").sendEmail({
      to: user.email, subject: notice.title,
      html: notice.receipt
        ? generalNotificationTemplate({ recipientName: user.firstName, title: notice.title,
            message: notice.message + " Date: " + (notice.receipt.eventDate ? new Date(notice.receipt.eventDate).toISOString() : "See ticket") +
              ". Total: " + notice.receipt.currency + " " + (notice.receipt.totalAmount / 100).toFixed(2) +
              ". Venue: " + (notice.receipt.venueName || "See ticket") })
        : generalNotificationTemplate({ recipientName: user.firstName, title: notice.title, message: notice.message }),
      idempotencyKey: `event-center-refund-notice/${notice._id}`,
    });
    if (!result?.id) throw new Error("Email provider is not configured or did not accept the email");
    await Outbox.updateOne(filter, { $set: { emailSentAt: new Date() } });
  }
  if (pushFailure) throw new Error("Push delivery needs retry");
  await Outbox.updateOne(filter, { $set: { completedAt: new Date(), lastError: null, lockedUntil: new Date(0) } });
}

async function processRefundNotices({ limit = 25, delayMs = 600 } = {}) {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const token = randomUUID();
    const notice = await Outbox.findOneAndUpdate({
      completedAt: null, failedAt: null, nextAttemptAt: { $lte: now }, lockedUntil: { $lte: now },
    }, { $set: { lockToken: token, lockedUntil: new Date(Date.now() + 5 * 60000) }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1 } });
    if (!notice) break;
    try { await deliverNotice(notice, token); }
    catch (error) {
      await Outbox.updateOne({ _id: notice._id, lockToken: token }, { $set: {
        failedAt: error.permanent || notice.attempts >= 12 ? new Date() : null,
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
module.exports = { queueNotices, processRefundNotices, deliverNotice };
