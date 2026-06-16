const mongoose = require("mongoose");

/* ===================== ENUMS ===================== */

const VENUE_TYPES = [
  "CONVENTION_CENTER",
  "CONFERENCE_HALL",
  "BANQUET_HALL",
  "HOTEL_VENUE",
  "THEATER_AUDITORIUM",
  "STADIUM_ARENA",
  "OUTDOOR_VENUE",
  "COMMUNITY_CENTER",
  "ART_GALLERY_MUSEUM",
  "CLUB_LOUNGE",
  "RELIGIOUS_VENUE",
  "MULTIPURPOSE_SPACE",
];
/* ===================== SAFETY OPTIONS ===================== */

const SAFETY_OPTIONS = [
  "FIRE_EXTINGUISHER",
  "EMERGENCY_EXIT",
  "CCTV",
  "FIRST_AID_KIT",
  "SMOKE_DETECTOR",
  "AED",
  "SECURITY_STATION",
  "EMERGENCY_LIGHTING",
];
const SAFETY_CONSIDERATIONS = [
  "FIRE_SAFETY_COMPLIANCE",
  "EMERGENCY_PLAN",
  "CROWD_MANAGEMENT",
  "MEDICAL_SUPPORT",
  "STRUCTURAL_INTEGRITY",
  "ACCESSIBILITY_SAFETY",
  "INCIDENT_REPORTING",
];
const AMENITIES = [
  "FOOD_STALLS",
  "BAR_DRINKS",
  "PARKING",
  "RESTROOMS",
  "FIRST_AID",
  "VIP_AREA",
  "SEATING",
  "MERCHANDISE",
  "WIFI",
  "ACCESSIBILITY",
  "PHOTOBOOTH",
  "CHARGING_STATIONS",
];

const SUPPORTED_EVENTS = Object.keys(
  require("./event.schema").eventLabels || {},
); // or hardcode same list

const VENUE_RULES = [
  "NO_SMOKING",
  "NO_ALCOHOL",
  "NO_LOUD_MUSIC",
  "NO_OUTSIDE_FOOD",
  "NO_PETS",
  "CHILD_FRIENDLY",
  "SECURITY_REQUIRED",
  "TIME_RESTRICTION",
  "CATERING_IN_HOUSE",
  "CATERING_OUTSIDE_ALLOWED",
  "NO_GLITTER_CONFETTI",
  "ALCOHOL_LICENSE_REQUIRED",
];

const DISCOUNTS = [
  "MULTI_DAY",
  "EARLY_BIRD",
  "OFF_PEAK",
  "NON_PROFIT",
  "LOYALTY",
];

/* ===================== SCHEMA ===================== */

const eventCenterSchema = new mongoose.Schema(
  {
    /* ===== BASIC ===== */

    venueType: {
      type: String,
      enum: VENUE_TYPES,
    },
    yearEstablished: {
      type: Number,
      min: 1800,
    },

    totalArea: {
      value: Number,
      unit: {
        type: String,
        enum: ["SQ_METERS", "SQ_FEET", "ACRES", "HECTARES"],
      },
    },

    hallType: {
      type: String,
    },

    venueSetting: {
      type: String,
    },

    venueName: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    shortDescription: {
      type: String,
      trim: true,
      maxlength: 250,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    guestAccessDescription: {
      type: String,
      trim: true,
    },
    interactionDescription: {
      type: String,
      trim: true,
    },
    neighborhoodDescription: {
      type: String,
      trim: true,
    },
    transitDescription: {
      type: String,
      trim: true,
    },
    otherDetailsDescription: {
      type: String,
      trim: true,
    },
    oneLiner: {
      type: String,
      trim: true,
      maxlength: 250,
    },
    theSpace: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    yourProperty: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    guestAccess: {
      type: String,
      trim: true,
    },
    interaction: {
      type: String,
      trim: true,
    },
    neighborhood: {
      type: String,
      trim: true,
    },
    transit: {
      type: String,
      trim: true,
    },
    otherDetails: {
      type: String,
      trim: true,
    },
    /* ===== LOCATION ===== */

    location: {
      addressString: String,
      street: String,
      flat: String,
      city: String,
      area: String,
      postcode: String,
      country: String,

      coordinates: {
        latitude: Number,
        longitude: Number,
      },

      isSpecificLocation: {
        type: Boolean,
        default: false,
      },
    },

    /* ===== SUPPORTED EVENTS ===== */

    supportedEvents: [
      {
        type: String,
        enum: SUPPORTED_EVENTS,
      },
    ],

    /* ===== MEDIA ===== */

    images: [
      {
        publicId: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
        position: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    /* ===== AMENITIES ===== */

    amenities: [
      {
        type: String,
        enum: AMENITIES,
      },
    ],

    /* ===== NEW AVAILABILITY SECTION ===== */
    availability: {
      minDuration: { type: Number, default: 1 },
      maxDuration: { type: Number, default: 365 },
      bookingWindow: { type: Number, enum: [3, 6, 9, 12, 24], default: 12 },
      unavailableDates: [
        {
          date: { type: Date, required: true },
          type: { type: String, enum: ["BLOCKED", "MANUAL"], default: "BLOCKED" },
          clientName: String,
          clientPhone: String,
          clientEmail: String,
          totalPrice: Number,
          depositAmount: Number,
          paymentStatus: {
            type: String,
            enum: ["pending", "partially_paid", "paid"],
            default: "pending",
          },
        },
      ],
      unavailableSlots: [
        {
          date: { type: Date, required: true },
          startTime: { type: String, required: true },
          endTime: { type: String, required: true },
        },
      ],
      customPrices: [
        {
          date: { type: Date, required: true },
          amount: { type: Number, required: true },
        },
      ],
      advanceNotice: {
        days: { type: Number, enum: [0, 1, 2, 3, 4, 5, 6, 7], default: 0 },
        sameDayCutoffTime: { type: String, default: "00:00" },
      },
      preparationTime: { type: Number, enum: [0, 1, 2], default: 0 },
      operationalHours: {
        open: { type: String, default: "06:00" },
        close: { type: String, default: "00:00" },
      },
    },

    /* ===== CAPACITY ===== */

    capacity: {
      max: {
        type: Number,
        min: 0,
      },
    },

    /* ===== BOOKING ===== */

    bookingSettings: {
      type: String,
      enum: ["REVIEW", "INSTANT"],
      default: "INSTANT",
    },

    basePrice: {
      amount: {
        type: Number,
        min: 0,
      },
      currency: {
        type: String,
        default: "NGN",
      },
      unit: {
        type: String,
        enum: ["hour", "day"],
      },
      feeMode: {
        type: String,
        enum: ["addon", "deduct"],
      },
      minDuration: {
        type: Number,
        min: 0,
      },
    },

    weekendPrice: {
      amount: {
        type: Number,
        min: 0,
      },
      currency: {
        type: String,
        default: "NGN",
      },
      unit: {
        type: String,
        enum: ["hour", "day"],
      },
      feeMode: {
        type: String,
        enum: ["addon", "deduct"],
      },
      minDuration: {
        type: Number,
        min: 0,
      },
    },

    discounts: [
      {
        type: String,
        enum: DISCOUNTS,
      },
    ],

    /* ===== RULES ===== */

    venueRules: [
      {
        type: String,
        enum: VENUE_RULES,
      },
    ],

    customVenueRules: [
      {
        title: {
          type: String,
          required: true,
        },
        description: String,
      },
    ],

    /* ===== SAFETY ===== */

    safety: [
      {
        type: String,
        enum: SAFETY_OPTIONS,
      },
    ],
    safetyConsiderations: [
      {
        type: String,
        enum: SAFETY_CONSIDERATIONS,
      },
    ],
    /* ===== ARRIVAL GUIDE ===== */

    checkIn: {
      isFlexible: { type: Boolean },
      start: { type: String },
      end: { type: String },
    },
    checkOut: {
      time: { type: String },
    },

    loadingDockDetails: {
      type: String,
      trim: true,
    },
    handoverDetails: {
      type: String,
      trim: true,
    },

    /* ===== META ===== */

    status: {
      type: String,
      enum: ["IN_PROGRESS", "ACTION_REQUIRED", "LISTED", "UNLISTED"],
      default: "IN_PROGRESS",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    coHosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    staff: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    /* ===== PERFORMANCE & ANALYTICS ===== */
    performance: {
      views: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      wishlists: { type: Number, default: 0 },
      reach: { type: Number, default: 0 },
      engagement: { type: Number, default: 0 },
      messages: { type: Number, default: 0 },
      pendingInquiries: { type: Number, default: 0 },
      responseRate: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      bookings: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

/* ===================== EXPORT ===================== */

module.exports = mongoose.model("EventCenter", eventCenterSchema);
