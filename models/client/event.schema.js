const mongoose = require("mongoose");

/* ===================== EVENT TYPE LABELS ===================== */

const eventLabels = {
  MUSIC_CONCERTS: "Music & Concerts",
  FESTIVALS_FAIRS: "Festivals & Fairs",
  PARTIES_NIGHTLIFE: "Parties & Nightlife",
  FOOD_DRINK: "Food & Drink",
  ARTS_CULTURE: "Arts & Culture",
  THEATER_PERFORMING_ARTS: "Theater & Performing Arts",
  COMEDY_ENTERTAINMENT: "Comedy & Entertainment",
  FILM_MEDIA: "Film & Media",
  SPORTS_FITNESS: "Sports & Fitness",
  OUTDOOR_ADVENTURE: "Outdoor & Adventure",
  HEALTH_WELLNESS: "Health & Wellness",
  YOGA_MEDITATION: "Yoga & Meditation",
  EDUCATION_LEARNING: "Education & Learning",
  WORKSHOPS_TRAINING: "Workshops & Training",
  CONFERENCES_SEMINARS: "Conferences & Seminars",
  BUSINESS_NETWORKING: "Business & Networking",
  TECHNOLOGY_INNOVATION: "Technology & Innovation",
  STARTUPS_ENTREPRENEURSHIP: "Startups & Entrepreneurship",
  CAREER_JOBS: "Career & Jobs",
  COMMUNITY_LOCAL: "Community & Local",
  FAMILY_KIDS: "Family & Kids",
  RELIGION_SPIRITUALITY: "Religion & Spirituality",
  CHARITY_FUNDRAISING: "Charity & Fundraising",
  GOVERNMENT_POLITICS: "Government & Politics",
  FASHION_BEAUTY: "Fashion & Beauty",
  SCIENCE_ENGINEERING: "Science & Engineering",
  LITERATURE_BOOKS: "Literature & Books",
  GAMING_ESPORTS: "Gaming & Esports",
  HOBBIES_CRAFTS: "Hobbies & Crafts",
  HOLIDAYS_SEASONAL: "Holidays & Seasonal",
};

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
/* ===================== EVENT SCHEMA ===================== */

const eventSchema = new mongoose.Schema(
  {
    /* ===== BASIC INFO ===== */

    title: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    shortDescription: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 250,
    },

    /* ===== IMAGES ===== */

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

    /* ===== HIGHLIGHTS & AMENITIES ===== */

    highlights: [{ type: String }],

    amenities: [
      {
        type: String,
        enum: [
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
        ],
      },
    ],

    /* ===== PERFORMERS (INLINE, EVENT-SCOPED) ===== */

    performers: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
          maxlength: 100,
        },

        role: {
          type: String,
          trim: true,
          maxlength: 100,
        },

        bio: {
          type: String,
          trim: true,
          maxlength: 500,
        },

        image: {
          type: String, // Image URL
          default: null,
        },

        socialLinks: [
          {
            platform: {
              type: String,
              required: true,
              enum: [
                "instagram",
                "twitter",
                "facebook",
                "linkedin",
                "youtube",
                "tiktok",
                "website",
              ],
            },

            url: {
              type: String,
              required: true,
              trim: true,
            },
          },
        ],
      },
    ],

    /* ===== EVENT TYPE ===== */

    eventType: {
      type: String,
      enum: Object.keys(eventLabels),
    },

    /* ===== AGE RESTRICTIONS ===== */

    ageRestriction: {
      minAge: {
        type: Number,
        min: 0,
        validate: {
          validator: (value) => value === undefined || Number.isInteger(value),
          message: "Minimum age must be a non-negative whole number",
        },
      },
      maxAge: {
        type: Number,
        min: 0,
        validate: {
          validator: function (value) {
            const min =
              this instanceof mongoose.Query
                ? (this.get("ageRestriction")?.minAge ??
                  this.get("ageRestriction.minAge"))
                : this.ageRestriction?.minAge;
            return (
              value === undefined ||
              (Number.isInteger(value) && (min == null || value >= min))
            );
          },
          message:
            "Maximum age must be a whole number at least equal to minimum age",
        },
      },
    },

    /* ===== SCHEDULE ===== */

    schedule: {
      timeZone: { type: String, maxlength: 80 },
      from: {
        type: Date,
      },
      to: {
        type: Date,
      },
    },

    /* ===== LOCATION ===== */

    location: {
      addressString: {
        type: String,
        trim: true,
      },

      street: {
        type: String,
        trim: true,
      },

      flat: {
        type: String,
        trim: true,
      },

      city: {
        type: String,
        trim: true,
      },

      area: {
        type: String,
        trim: true,
      },

      postcode: {
        type: String,
        trim: true,
      },

      country: {
        type: String,
        trim: true,
      },

      coordinates: {
        latitude: Number,
        longitude: Number,
      },

      isSpecificLocation: {
        type: Boolean,
        default: false,
      },
    },

    /* ===== META ===== */

    capacity: {
      type: Number,
      min: 0,
    },
    /* ===== SAFETY & SECURITY ===== */

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
    /* ===== TICKETS & ENTRY ===== */

    entry: {
      ticketRequired: {
        type: Boolean,
        default: false,
      },

      onSiteTickets: {
        type: Boolean,
        default: false,
      },

      idRequired: {
        type: Boolean,
        default: false,
      },
    },

    /* ===== GUIDES ===== */

    ticketGuide: {
      // Retained for existing policy editors and attendee-facing readers.
      refundPolicy: { type: String, trim: true },
      platformPolicyAcknowledged: { type: Boolean },
      refundPolicyType: { type: String, enum: ["NO_REFUNDS", "REFUNDS_BEFORE_EVENT", "CUSTOM"] },
      refundWindowDays: { type: Number, min: 1, max: 365, validate: { validator: (value) => value == null || Number.isInteger(value), message: "Refund window must be a whole number of days" } },
      refundAmountType: { type: String, enum: ["FULL", "PARTIAL", null] },
      partialRefundPercentage: { type: Number, min: 1, max: 99 },
      customRefundTerms: { type: String, trim: true, maxlength: 1000 },
      cancellationNotificationMethod: { type: String, trim: true, maxlength: 500 },
      cancellationRefundProcess: { type: String, trim: true, maxlength: 1000 },
      cancellationRefundTimeline: { type: String, trim: true, maxlength: 500 },
      description: {
        type: String,
        trim: true,
        maxlength: 1000,
      },
      includeFees: {
        type: Boolean,
        default: false,
      },
    },

    // ========================= Refund and cancellation  ========================================

    cancellationRefundProcess: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    cancellationRefundTimeline: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    // ========================= Refund and cancellation  ========================================

    arrivalGuide: {
      notes: {
        type: String,
        trim: true,
        maxlength: 1000,
      },
      parking: {
        type: String,
        trim: true,
        maxlength: 500,
      },
      checkInInstructions: {
        type: String,
        trim: true,
        maxlength: 1000,
      },
    },

    status: {
      type: String,
      enum: [
        "IN_PROGRESS",
        "ACTION_REQUIRED",
        "LISTED",
        "UNLISTED",
        "CANCELLED",
        "COMPLETED",
      ],
      default: "IN_PROGRESS",
    },

    // Cancellation is a terminal, customer-facing state. Financial obligations
    // are kept in EventRefund records rather than changing the original payment.
    lifecycle: {
      cancellationMessage: { type: String, trim: true, maxlength: 1000 },
      refundDueAt: Date,
      cancelledAt: Date,
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    // Incremented whenever ticket inventory is reserved. This deliberately
    // serializes a reservation against cancellation of the same event.
    saleVersion: { type: Number, default: 0 },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    coOrganisers: [
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
      ticketSales: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

/* ===================== INDEXES ===================== */

eventSchema.index({ createdBy: 1, status: 1 });
eventSchema.index({ status: 1, "schedule.to": 1 });
eventSchema.index({ status: 1, createdAt: -1 });

/* ===================== HUMAN-READABLE LABEL ===================== */

eventSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.eventTypeLabel = eventLabels[obj.eventType];
  return obj;
};

/* ===================== EXPORT ===================== */

eventSchema.add({
  managementLocation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "GeographicLocation",
    default: null,
    index: true,
  },
});
eventSchema.index({ managementLocation: 1, createdAt: -1 });
eventSchema.plugin(require("./geographicAssignment"));
eventSchema.plugin(require("./listingModeration"));

module.exports = mongoose.model("Event", eventSchema);
module.exports.eventLabels = eventLabels;
