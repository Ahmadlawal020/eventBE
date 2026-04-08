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
      unavailableDates: [{ type: Date }],
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
      default: "REVIEW",
    },

    basePrice: {
      amount: {
        type: Number,
        min: 0,
      },
      currency: {
        type: String,
        default: "USD",
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
        default: "USD",
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

    isDraft: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

/* ===================== EXPORT ===================== */

module.exports = mongoose.model("EventCenter", eventCenterSchema);
