const Notification = require("../../models/client/notification.schema");
const User = require("../../models/client/user.schema");
const { sendPushNotifications } = require("./push.service");
const { sendEmail } = require("../email.service");
const emailTemplates = require("./emailTemplates");
const {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  TYPE_CONFIG,
  CATEGORY_TO_PREFERENCE_KEY,
} = require("../../constants/notificationTypes");

/**
 * Checks if a user has enabled a specific channel for a notification category.
 */
const isChannelEnabled = (preferences = {}, category, channel) => {
  if (!preferences) return true;

  const channels = preferences.channels || {};
  const categories = preferences.categories || {};

  if (channel === "push" && channels.push === false) return false;
  if (channel === "email" && channels.email === false) return false;
  if (channel === "sms" && channels.sms === false) return false;

  const prefKey = CATEGORY_TO_PREFERENCE_KEY[category];
  if (prefKey && categories[prefKey] === false) {
    return false;
  }

  return true;
};

/**
 * Dispatches a notification across enabled channels (In-App, Push, Email).
 * Includes deduplication support to prevent duplicate notifications on webhook retries or race conditions.
 */
const dispatchNotification = async ({
  recipient,
  sender = null,
  type,
  title,
  message,
  referenceId = null,
  referenceType = null,
  data = {},
  priority,
  channels,
  email,
  deduplicate = false,
}) => {
  try {
    if (!recipient) {
      console.warn("[NOTIFICATION ENGINE] Missing recipient, skipping dispatch.");
      return null;
    }

    // Deduplication check (avoids double notifications for the same event/referenceId)
    if (deduplicate && referenceId) {
      const existing = await Notification.findOne({
        recipient,
        type,
        referenceId,
      }).lean();

      if (existing) {
        return existing;
      }
    }

    const typeConfig = TYPE_CONFIG[type] || {
      category: NOTIFICATION_CATEGORIES.SYSTEM,
      defaultChannels: ["in_app", "push"],
      priority: "normal",
    };

    const category = typeConfig.category;
    const finalPriority = priority || typeConfig.priority || "normal";
    const configuredChannels = channels || typeConfig.defaultChannels || ["in_app", "push"];

    // 1. Fetch recipient profile & preferences
    const recipientUser = await User.findById(recipient)
      .select("firstName surname email pushTokens notificationPreferences")
      .lean();

    if (!recipientUser) {
      console.warn(`[NOTIFICATION ENGINE] Recipient user ${recipient} not found.`);
      return null;
    }

    const prefs = recipientUser.notificationPreferences;
    const deliveryRecords = [];

    // 2. In-App Notification
    let inAppDoc = null;
    if (configuredChannels.includes("in_app")) {
      try {
        inAppDoc = await Notification.create({
          recipient,
          sender,
          type,
          category,
          title,
          message,
          referenceId,
          referenceType,
          data: {
            ...data,
            type,
            referenceId: referenceId ? String(referenceId) : undefined,
          },
          priority: finalPriority,
          channelsDelivered: [],
        });
        deliveryRecords.push({ channel: "in_app", status: "SENT", sentAt: new Date() });
      } catch (inAppErr) {
        console.error("[NOTIFICATION ENGINE] In-App creation error:", inAppErr.message);
        deliveryRecords.push({ channel: "in_app", status: "FAILED", sentAt: new Date(), error: inAppErr.message });
      }
    }

    // 3. Push Notification (Asynchronous / Non-blocking)
    if (configuredChannels.includes("push")) {
      const pushEnabled = isChannelEnabled(prefs, category, "push");
      const pushTokens = (recipientUser.pushTokens || []).map((t) => t.token);

      if (pushEnabled && pushTokens.length > 0) {
        try {
          const pushPayload = {
            tokens: pushTokens,
            title,
            body: message,
            data: {
              ...data,
              type,
              referenceId: referenceId ? String(referenceId) : undefined,
              notificationId: inAppDoc ? String(inAppDoc._id) : undefined,
            },
            priority: finalPriority === "urgent" ? "high" : "default",
          };

          const pushResult = await sendPushNotifications(pushPayload);

          if (pushResult.successCount > 0) {
            deliveryRecords.push({ channel: "push", status: "SENT", sentAt: new Date() });
          } else {
            deliveryRecords.push({
              channel: "push",
              status: "FAILED",
              sentAt: new Date(),
              error: pushResult.errors?.[0]?.error || "Push delivery failed",
            });
          }

          if (pushResult.invalidTokens?.length > 0) {
            await User.updateOne(
              { _id: recipient },
              { $pull: { pushTokens: { token: { $in: pushResult.invalidTokens } } } }
            );
            console.log(`[NOTIFICATION ENGINE] Pruned ${pushResult.invalidTokens.length} invalid push token(s) for user ${recipient}`);
          }
        } catch (pushErr) {
          console.error("[NOTIFICATION ENGINE] Push delivery error:", pushErr.message);
          deliveryRecords.push({ channel: "push", status: "FAILED", sentAt: new Date(), error: pushErr.message });
        }
      } else {
        deliveryRecords.push({
          channel: "push",
          status: "SKIPPED",
          sentAt: new Date(),
          error: !pushEnabled ? "User opted out of push" : "No push tokens registered",
        });
      }
    }

    // 4. Email Notification
    if (configuredChannels.includes("email") && recipientUser.email) {
      const emailEnabled = isChannelEnabled(prefs, category, "email");
      if (emailEnabled) {
        try {
          const emailSubject = email?.subject || title;
          let emailHtml = email?.html;

          if (!emailHtml) {
            emailHtml = emailTemplates.generalNotificationTemplate({
              recipientName: recipientUser.firstName,
              title,
              message,
              actionUrl: data.deepLink || null,
            });
          }

          await sendEmail({
            to: recipientUser.email,
            subject: emailSubject,
            html: emailHtml,
          });

          deliveryRecords.push({ channel: "email", status: "SENT", sentAt: new Date() });
        } catch (emailErr) {
          console.error("[NOTIFICATION ENGINE] Email delivery error:", emailErr.message);
          deliveryRecords.push({ channel: "email", status: "FAILED", sentAt: new Date(), error: emailErr.message });
        }
      } else {
        deliveryRecords.push({ channel: "email", status: "SKIPPED", sentAt: new Date(), error: "User opted out of email" });
      }
    }

    // 5. Update delivery tracking status
    if (inAppDoc && deliveryRecords.length > 0) {
      inAppDoc.channelsDelivered = deliveryRecords;
      await inAppDoc.save().catch(() => {});
    }

    return inAppDoc;
  } catch (error) {
    console.error("[NOTIFICATION ENGINE - DISPATCH ERROR]:", error);
    return null;
  }
};

/**
 * Bulk Dispatch for Broadcasts & Event Reminders
 */
const dispatchBulkNotifications = async ({
  recipients = [],
  sender = null,
  type,
  title,
  message,
  data = {},
  priority = "normal",
  channels,
}) => {
  if (!recipients || recipients.length === 0) {
    return { total: 0, inAppCount: 0, pushCount: 0, emailCount: 0 };
  }

  const typeConfig = TYPE_CONFIG[type] || {
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  };

  const category = typeConfig.category;
  const configuredChannels = channels || typeConfig.defaultChannels || ["in_app", "push"];

  const users = await User.find({ _id: { $in: recipients } })
    .select("_id firstName email pushTokens notificationPreferences")
    .lean();

  const inAppDocs = [];
  const pushTokensToSend = [];
  const emailRecipients = [];

  for (const user of users) {
    const prefs = user.notificationPreferences;

    if (configuredChannels.includes("in_app")) {
      inAppDocs.push({
        recipient: user._id,
        sender,
        type,
        category,
        title,
        message,
        data: { ...data, type },
        priority,
      });
    }

    if (configuredChannels.includes("push") && isChannelEnabled(prefs, category, "push")) {
      const userTokens = (user.pushTokens || []).map((t) => t.token);
      pushTokensToSend.push(...userTokens);
    }
    if (configuredChannels.includes("email") && user.email &&
        (type === NOTIFICATION_TYPES.EVENT_CANCELLED || isChannelEnabled(prefs, category, "email"))) {
      emailRecipients.push(user);
    }
  }

  let inAppCount = 0;
  if (inAppDocs.length > 0) {
    try {
      const inserted = await Notification.insertMany(inAppDocs, { ordered: false });
      inAppCount = inserted.length;
    } catch (insertErr) {
      inAppCount = insertErr.insertedDocs?.length || 0;
      console.error("[NOTIFICATION ENGINE] Bulk in-app insert error:", insertErr.message);
    }
  }

  let pushCount = 0;
  if (pushTokensToSend.length > 0) {
    try {
      const pushResult = await sendPushNotifications({
        tokens: pushTokensToSend,
        title,
        body: message,
        data: { ...data, type },
        priority: priority === "urgent" ? "high" : "default",
      });
      pushCount = pushResult.successCount;
    } catch (pushErr) {
      console.error("[NOTIFICATION ENGINE] Bulk push error:", pushErr.message);
    }
  }

  let emailCount = 0;
  if (emailRecipients.length > 0) {
    const deliveries = await Promise.allSettled(emailRecipients.map((user) => sendEmail({
      to: user.email,
      subject: title,
      html: emailTemplates.generalNotificationTemplate({
        recipientName: user.firstName,
        title,
        message,
        actionUrl: data.deepLink || null,
      }),
    })));
    emailCount = deliveries.filter((delivery) =>
      delivery.status === "fulfilled" && delivery.value?.id,
    ).length;
    const failedCount = deliveries.length - emailCount;
    if (failedCount) {
      console.error("[NOTIFICATION ENGINE] Bulk email delivery incomplete:", {
        failedCount,
        reason: deliveries.find((delivery) => delivery.status === "rejected")?.reason?.message ||
          "Email provider did not confirm delivery; check email configuration.",
      });
    }
  }

  return {
    total: recipients.length,
    inAppCount,
    pushCount,
    emailCount,
  };
};

// ============================================================================
// DOMAIN-LEVEL HIGH-LEVEL NOTIFICATION DISPATCHERS (Clean Architecture)
// ============================================================================

/**
 * 🎟️ Dispatches Ticket Purchase notifications to Buyer (In-App, Push, Email) and Organiser (In-App, Push)
 */
const notifyTicketPurchased = async ({ booking, event, buyer, reference }) => {
  if (!booking || !buyer) return;

  const eventTitle = event?.title || "Upcoming Event";
  const items = booking.items || [];
  const totalTickets = items.reduce((acc, item) => acc + (item.quantity || 1), 0) || 1;
  const buyerName = buyer.firstName || buyer.fullName || "Attendee";
  const buyerId = buyer._id || buyer.id;

  // 1. Notify Buyer (with deduplication)
  await dispatchNotification({
    recipient: buyerId,
    type: NOTIFICATION_TYPES.TICKET_PURCHASED,
    title: "Tickets Confirmed! 🎉",
    message: `Your ${totalTickets} ticket(s) for "${eventTitle}" are confirmed and ready in your app.`,
    referenceId: booking._id,
    referenceType: "EventBooking",
    deduplicate: true,
    data: {
      screen: "TicketDetails",
      bookingId: String(booking._id),
      eventId: String(booking.eventId || event?._id),
    },
    email: {
      subject: `Tickets Confirmed: ${eventTitle} - Munasaba`,
      html: emailTemplates.ticketPurchaseTemplate({
        attendeeName: buyerName,
        eventTitle,
        eventDate: event?.schedule?.from ? new Date(event.schedule.from).toLocaleDateString() : null,
        venueName: event?.venueName || event?.location?.name,
        ticketCount: totalTickets,
        totalAmount: booking.totalAmount || 0,
        bookingReference: reference || booking.paymentReference,
      }),
    },
  });

  // 2. Notify Event Organiser
  const creatorId = event?.createdBy?._id || event?.createdBy;
  if (creatorId) {
    await dispatchNotification({
      recipient: creatorId,
      sender: buyerId,
      type: NOTIFICATION_TYPES.BOOKING_CREATED,
      title: "New Ticket Sale! 🎟️",
      message: `${buyerName} purchased ${totalTickets} ticket(s) for "${eventTitle}".`,
      referenceId: booking._id,
      referenceType: "EventBooking",
      deduplicate: true,
      data: {
        screen: "EventDetails",
        eventId: String(booking.eventId || event?._id),
      },
    });
  }
};

/**
 * 🏛️ Dispatches Venue Booking Request notifications (Review Mode)
 */
const notifyVenueBookingRequest = async ({ booking, eventCenter, guestName, buyerId, organiserId }) => {
  const venueName = eventCenter?.venueName || "your venue";
  const bookingDatesStr = Array.isArray(booking?.selectedDates)
    ? booking.selectedDates.map((d) => (d.date ? new Date(d.date).toLocaleDateString() : String(d))).join(", ")
    : "";

  // Notify Organiser
  await dispatchNotification({
    recipient: organiserId,
    sender: buyerId,
    type: NOTIFICATION_TYPES.BOOKING_REQUEST,
    title: "New Booking Request ⏳",
    message: `${guestName} requested to book ${venueName}. Please review within 24 hours.`,
    referenceId: booking._id,
    referenceType: "EventCenterBooking",
    deduplicate: true,
    data: {
      screen: "BookingReview",
      ticketId: String(booking._id),
      eventCenterId: String(eventCenter?._id || booking.eventCenter),
    },
    email: {
      subject: `New Booking Request: ${venueName} - Munasaba`,
      html: emailTemplates.venueBookingTemplate({
        recipientName: "Host",
        title: "New Booking Request",
        message: `${guestName} has requested to book ${venueName}. Please review and accept or decline within 24 hours.`,
        venueName,
        bookingDates: bookingDatesStr,
        totalAmount: booking.totalPrice,
        status: "PENDING_REVIEW",
      }),
    },
  });

  // Notify Buyer
  await dispatchNotification({
    recipient: buyerId,
    type: NOTIFICATION_TYPES.BOOKING_CREATED,
    title: "Booking Request Submitted",
    message: `Your booking request for ${venueName} has been submitted. The host has 24 hours to review.`,
    referenceId: booking._id,
    referenceType: "EventCenterBooking",
    deduplicate: true,
    data: {
      screen: "BookingDetails",
      ticketId: String(booking._id),
    },
  });
};

/**
 * 🏛️ Dispatches Instant Venue Booking notifications
 */
const notifyVenueBookingInstant = async ({ booking, eventCenter, guestName, buyerId, organiserId }) => {
  const venueName = eventCenter?.venueName || "your venue";
  const bookingDatesStr = Array.isArray(booking?.selectedDates)
    ? booking.selectedDates.map((d) => (d.date ? new Date(d.date).toLocaleDateString() : String(d))).join(", ")
    : "";

  // Notify Organiser
  await dispatchNotification({
    recipient: organiserId,
    sender: buyerId,
    type: NOTIFICATION_TYPES.BOOKING_CREATED,
    title: "New Venue Booking! 🏛️",
    message: `${guestName} booked ${venueName}.`,
    referenceId: booking._id,
    referenceType: "EventCenterBooking",
    deduplicate: true,
    data: {
      screen: "BookingDetails",
      ticketId: String(booking._id),
      eventCenterId: String(eventCenter?._id || booking.eventCenter),
    },
  });

  // Notify Buyer
  await dispatchNotification({
    recipient: buyerId,
    type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
    title: "Venue Booking Confirmed! 🎉",
    message: `Your booking for ${venueName} is confirmed. Your digital ticket is ready in your app.`,
    referenceId: booking._id,
    referenceType: "EventCenterBooking",
    deduplicate: true,
    data: {
      screen: "TicketDetails",
      ticketId: String(booking._id),
    },
    email: {
      subject: `Booking Confirmed: ${venueName} - Munasaba`,
      html: emailTemplates.venueBookingTemplate({
        recipientName: guestName,
        title: "Booking Confirmed!",
        message: `Your booking at ${venueName} is confirmed. You can access your ticket anytime in the Munasaba app.`,
        venueName,
        bookingDates: bookingDatesStr,
        totalAmount: booking.totalPrice,
        status: "CONFIRMED",
      }),
    },
  });
};

/**
 * 🎫 Dispatches Ticket Transfer Request notification
 */
const notifyTransferRequested = async ({ transferRequest, sender, recipient, eventTitle }) => {
  const recipientName = `${recipient.firstName || ""} ${recipient.surname || ""}`.trim();
  const senderName = sender.name || "A user";

  await dispatchNotification({
    recipient: recipient._id || recipient.id,
    sender: sender.id || sender._id,
    type: NOTIFICATION_TYPES.TICKET_TRANSFER_REQUEST,
    title: "Ticket Transfer Request 🎟️",
    message: `${senderName} wants to transfer a ticket for ${eventTitle} to you. Tap to review.`,
    referenceId: transferRequest._id,
    referenceType: "TicketTransferRequest",
    deduplicate: true,
    data: {
      screen: "TransferReview",
      requestId: String(transferRequest._id),
    },
    email: {
      subject: `Ticket Transfer from ${senderName} - Munasaba`,
      html: emailTemplates.ticketTransferTemplate({
        recipientName,
        title: "Ticket Transfer Request",
        message: `${senderName} wants to transfer a ticket for ${eventTitle} to you.`,
        senderName,
        eventTitle,
      }),
    },
  });
};

/**
 * 🤝 Dispatches Co-Organiser Invitation notification
 */
const notifyCoOrganiserInvited = async ({ invitation, hostUser, coOrganiserUser, listingsCount = 1 }) => {
  const hostName = `${hostUser?.firstName || ""} ${hostUser?.surname || ""}`.trim() || "A host";

  await dispatchNotification({
    recipient: coOrganiserUser._id || coOrganiserUser.id,
    sender: hostUser._id || hostUser.id,
    type: NOTIFICATION_TYPES.CO_ORGANISER_INVITATION,
    title: "New Co-organiser Invitation 🤝",
    message: `${hostName} invited you to be a co-organiser for one or more listings. Tap to review.`,
    referenceId: invitation._id,
    referenceType: "CoOrganiserInvitation",
    deduplicate: true,
    data: {
      screen: "CoOrganiserInvite",
      invitationId: String(invitation._id),
    },
    email: {
      subject: `Co-organiser Invitation from ${hostName} - Munasaba`,
      html: emailTemplates.invitationTemplate({
        recipientName: coOrganiserUser.firstName,
        senderName: hostName,
        roleName: "Co-Organiser",
        listingNames: `${listingsCount} listing(s)`,
      }),
    },
  });
};

/**
 * 🎫 Dispatches Staff Member Invitation notification
 */
const notifyStaffInvited = async ({ invitation, organiserUser, staffUser, listingsCount = 1 }) => {
  const organiserName = `${organiserUser?.firstName || ""} ${organiserUser?.surname || ""}`.trim() || "An organiser";

  await dispatchNotification({
    recipient: staffUser._id || staffUser.id,
    sender: organiserUser._id || organiserUser.id,
    type: NOTIFICATION_TYPES.STAFF_INVITATION,
    title: "New Staff Invitation 🎫",
    message: `${organiserName} invited you to be a staff member for one or more listings. Tap to review.`,
    referenceId: invitation._id,
    referenceType: "StaffInvitation",
    deduplicate: true,
    data: {
      screen: "StaffInvite",
      invitationId: String(invitation._id),
    },
    email: {
      subject: `Staff Invitation from ${organiserName} - Munasaba`,
      html: emailTemplates.invitationTemplate({
        recipientName: staffUser.firstName,
        senderName: organiserName,
        roleName: "Staff Member",
        listingNames: `${listingsCount} listing(s)`,
      }),
    },
  });
};

module.exports = {
  dispatchNotification,
  dispatchBulkNotifications,
  isChannelEnabled,
  notifyTicketPurchased,
  notifyVenueBookingRequest,
  notifyVenueBookingInstant,
  notifyTransferRequested,
  notifyCoOrganiserInvited,
  notifyStaffInvited,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  emailTemplates,
};
