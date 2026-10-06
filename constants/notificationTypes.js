/**
 * Centralized Notification Constants, Types, Categories, and Channel Mappings
 */

const NOTIFICATION_CATEGORIES = {
  BOOKINGS: "BOOKINGS",
  TICKETS: "TICKETS",
  TEAM: "TEAM",
  MESSAGES: "MESSAGES",
  REMINDERS: "REMINDERS",
  PROMOTIONS: "PROMOTIONS",
  SYSTEM: "SYSTEM",
};

const NOTIFICATION_TYPES = {
  VENUE_SESSION_REMINDER: "VENUE_SESSION_REMINDER",
  VENUE_PAYMENT_DUE: "VENUE_PAYMENT_DUE",
  VENUE_ATTENDANCE_FOLLOWUP: "VENUE_ATTENDANCE_FOLLOWUP",
  // Bookings & Venues
  BOOKING_CREATED: "BOOKING_CREATED",
  BOOKING_REQUEST: "BOOKING_REQUEST",
  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  BOOKING_DECLINED: "BOOKING_DECLINED",
  BOOKING_EXPIRED: "BOOKING_EXPIRED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
  BOOKING_UPDATE: "BOOKING_UPDATE", // Legacy backward compatibility

  // Event Tickets & Transfers
  TICKET_PURCHASED: "TICKET_PURCHASED",
  TICKET_TRANSFER_REQUEST: "TICKET_TRANSFER_REQUEST",
  TICKET_TRANSFER_ACCEPTED: "TICKET_TRANSFER_ACCEPTED",
  TICKET_TRANSFER_DECLINED: "TICKET_TRANSFER_DECLINED",
  TICKET_TRANSFER_CANCELLED: "TICKET_TRANSFER_CANCELLED",

  // Team & Collaboration
  CO_ORGANISER_INVITATION: "CO_ORGANISER_INVITATION",
  CO_ORGANISER_ACCEPTED: "CO_ORGANISER_ACCEPTED",
  CO_ORGANISER_DECLINED: "CO_ORGANISER_DECLINED",
  CO_ORGANISER_REMOVED: "CO_ORGANISER_REMOVED",
  STAFF_INVITATION: "STAFF_INVITATION",
  STAFF_ACCEPTED: "STAFF_ACCEPTED",
  STAFF_DECLINED: "STAFF_DECLINED",
  STAFF_LEFT: "STAFF_LEFT",

  // Chat & Messaging
  MESSAGE_RECEIVED: "MESSAGE_RECEIVED",

  // Reminders & Lifecycle
  EVENT_REMINDER_24H: "EVENT_REMINDER_24H",
  EVENT_REMINDER_2H: "EVENT_REMINDER_2H",
  BOOKING_REVIEW_REMINDER: "BOOKING_REVIEW_REMINDER",
  TICKET_SALES_STARTED: "TICKET_SALES_STARTED",
  TICKET_SALES_ENDED: "TICKET_SALES_ENDED",
  EVENT_COMPLETED: "EVENT_COMPLETED",

  // System & Marketing
  SYSTEM: "SYSTEM",
  PROMOTION: "PROMOTION",
  ANNOUNCEMENT: "ANNOUNCEMENT",
  REFERRAL_REWARD: "REFERRAL_REWARD",
};

/**
 * Maps notification types to categories and default delivery channels.
 */
const TYPE_CONFIG = {
  [NOTIFICATION_TYPES.VENUE_SESSION_REMINDER]: { category: NOTIFICATION_CATEGORIES.REMINDERS, defaultChannels: ["in_app", "push"], priority: "normal" },
  [NOTIFICATION_TYPES.VENUE_PAYMENT_DUE]: { category: NOTIFICATION_CATEGORIES.REMINDERS, defaultChannels: ["in_app", "push"], priority: "normal" },
  [NOTIFICATION_TYPES.VENUE_ATTENDANCE_FOLLOWUP]: { category: NOTIFICATION_CATEGORIES.REMINDERS, defaultChannels: ["in_app", "push"], priority: "normal" },
  // Bookings
  [NOTIFICATION_TYPES.BOOKING_CREATED]: {
    category: NOTIFICATION_CATEGORIES.BOOKINGS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "high",
  },
  [NOTIFICATION_TYPES.BOOKING_REQUEST]: {
    category: NOTIFICATION_CATEGORIES.BOOKINGS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "urgent",
  },
  [NOTIFICATION_TYPES.BOOKING_CONFIRMED]: {
    category: NOTIFICATION_CATEGORIES.BOOKINGS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "high",
  },
  [NOTIFICATION_TYPES.BOOKING_DECLINED]: {
    category: NOTIFICATION_CATEGORIES.BOOKINGS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "high",
  },
  [NOTIFICATION_TYPES.BOOKING_EXPIRED]: {
    category: NOTIFICATION_CATEGORIES.BOOKINGS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.BOOKING_CANCELLED]: {
    category: NOTIFICATION_CATEGORIES.BOOKINGS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "high",
  },
  [NOTIFICATION_TYPES.BOOKING_UPDATE]: {
    category: NOTIFICATION_CATEGORIES.BOOKINGS,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },

  // Tickets
  [NOTIFICATION_TYPES.TICKET_PURCHASED]: {
    category: NOTIFICATION_CATEGORIES.TICKETS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "high",
  },
  [NOTIFICATION_TYPES.TICKET_TRANSFER_REQUEST]: {
    category: NOTIFICATION_CATEGORIES.TICKETS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "urgent",
  },
  [NOTIFICATION_TYPES.TICKET_TRANSFER_ACCEPTED]: {
    category: NOTIFICATION_CATEGORIES.TICKETS,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.TICKET_TRANSFER_DECLINED]: {
    category: NOTIFICATION_CATEGORIES.TICKETS,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.TICKET_TRANSFER_CANCELLED]: {
    category: NOTIFICATION_CATEGORIES.TICKETS,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },

  // Team & Invites
  [NOTIFICATION_TYPES.CO_ORGANISER_INVITATION]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push", "email"],
    priority: "urgent",
  },
  [NOTIFICATION_TYPES.CO_ORGANISER_ACCEPTED]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.CO_ORGANISER_DECLINED]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.CO_ORGANISER_REMOVED]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.STAFF_INVITATION]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push", "email"],
    priority: "urgent",
  },
  [NOTIFICATION_TYPES.STAFF_ACCEPTED]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.STAFF_DECLINED]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.STAFF_LEFT]: {
    category: NOTIFICATION_CATEGORIES.TEAM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },

  // Messages
  [NOTIFICATION_TYPES.MESSAGE_RECEIVED]: {
    category: NOTIFICATION_CATEGORIES.MESSAGES,
    defaultChannels: ["in_app", "push"],
    priority: "high",
  },

  // Reminders
  [NOTIFICATION_TYPES.EVENT_REMINDER_24H]: {
    category: NOTIFICATION_CATEGORIES.REMINDERS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.EVENT_REMINDER_2H]: {
    category: NOTIFICATION_CATEGORIES.REMINDERS,
    defaultChannels: ["in_app", "push"],
    priority: "high",
  },
  [NOTIFICATION_TYPES.BOOKING_REVIEW_REMINDER]: {
    category: NOTIFICATION_CATEGORIES.REMINDERS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "urgent",
  },
  [NOTIFICATION_TYPES.TICKET_SALES_STARTED]: {
    category: NOTIFICATION_CATEGORIES.REMINDERS,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.TICKET_SALES_ENDED]: {
    category: NOTIFICATION_CATEGORIES.REMINDERS,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.EVENT_COMPLETED]: {
    category: NOTIFICATION_CATEGORIES.REMINDERS,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },

  // System & Marketing
  [NOTIFICATION_TYPES.SYSTEM]: {
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.PROMOTION]: {
    category: NOTIFICATION_CATEGORIES.PROMOTIONS,
    defaultChannels: ["in_app", "push"],
    priority: "low",
  },
  [NOTIFICATION_TYPES.ANNOUNCEMENT]: {
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    defaultChannels: ["in_app", "push"],
    priority: "normal",
  },
  [NOTIFICATION_TYPES.REFERRAL_REWARD]: {
    category: NOTIFICATION_CATEGORIES.PROMOTIONS,
    defaultChannels: ["in_app", "push", "email"],
    priority: "high",
  },
};

/**
 * Mapping between notification category and user notification preference key
 */
const CATEGORY_TO_PREFERENCE_KEY = {
  [NOTIFICATION_CATEGORIES.BOOKINGS]: "bookings",
  [NOTIFICATION_CATEGORIES.TICKETS]: "tickets",
  [NOTIFICATION_CATEGORIES.TEAM]: "teamAndInvites",
  [NOTIFICATION_CATEGORIES.MESSAGES]: "messages",
  [NOTIFICATION_CATEGORIES.REMINDERS]: "reminders",
  [NOTIFICATION_CATEGORIES.PROMOTIONS]: "offersAndPromotions",
  [NOTIFICATION_CATEGORIES.SYSTEM]: "newsAndUpdates",
};

module.exports = {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  TYPE_CONFIG,
  CATEGORY_TO_PREFERENCE_KEY,
};
