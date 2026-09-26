const { Schema, model } = require("mongoose");

const EVENT_CATEGORIES = [
  ["MUSIC_CONCERTS", "Music & Concerts"],
  ["FESTIVALS_FAIRS", "Festivals & Fairs"],
  ["PARTIES_NIGHTLIFE", "Parties & Nightlife"],
  ["FOOD_DRINK", "Food & Drink"],
  ["ARTS_CULTURE", "Arts & Culture"],
  ["THEATER_PERFORMING_ARTS", "Theater & Performing Arts"],
  ["COMEDY_ENTERTAINMENT", "Comedy & Entertainment"],
  ["FILM_MEDIA", "Film & Media"],
  ["SPORTS_FITNESS", "Sports & Fitness"],
  ["OUTDOOR_ADVENTURE", "Outdoor & Adventure"],
  ["HEALTH_WELLNESS", "Health & Wellness"],
  ["YOGA_MEDITATION", "Yoga & Meditation"],
  ["EDUCATION_LEARNING", "Education & Learning"],
  ["WORKSHOPS_TRAINING", "Workshops & Training"],
  ["CONFERENCES_SEMINARS", "Conferences & Seminars"],
  ["BUSINESS_NETWORKING", "Business & Networking"],
  ["TECHNOLOGY_INNOVATION", "Technology & Innovation"],
  ["STARTUPS_ENTREPRENEURSHIP", "Startups & Entrepreneurship"],
  ["CAREER_JOBS", "Career & Jobs"],
  ["COMMUNITY_LOCAL", "Community & Local"],
  ["FAMILY_KIDS", "Family & Kids"],
  ["RELIGION_SPIRITUALITY", "Religion & Spirituality"],
  ["CHARITY_FUNDRAISING", "Charity & Fundraising"],
  ["GOVERNMENT_POLITICS", "Government & Politics"],
  ["FASHION_BEAUTY", "Fashion & Beauty"],
  ["SCIENCE_ENGINEERING", "Science & Engineering"],
  ["LITERATURE_BOOKS", "Literature & Books"],
  ["GAMING_ESPORTS", "Gaming & Esports"],
  ["HOBBIES_CRAFTS", "Hobbies & Crafts"],
  ["HOLIDAYS_SEASONAL", "Holidays & Seasonal"],
];

const EVENT_AMENITIES = [
  ["FOOD_STALLS", "Food stalls"],
  ["BAR_DRINKS", "Bar & drinks"],
  ["PARKING", "Parking"],
  ["RESTROOMS", "Restrooms"],
  ["FIRST_AID", "First aid"],
  ["VIP_AREA", "VIP area"],
  ["SEATING", "Seating"],
  ["MERCHANDISE", "Merchandise"],
  ["WIFI", "Wi-Fi"],
  ["ACCESSIBILITY", "Accessibility"],
  ["PHOTOBOOTH", "Photo booth"],
  ["CHARGING_STATIONS", "Charging stations"],
];

const EVENT_SAFETY_OPTIONS = [
  ["FIRE_EXTINGUISHER", "Fire extinguisher"],
  ["EMERGENCY_EXIT", "Emergency exit"],
  ["CCTV", "CCTV"],
  ["FIRST_AID_KIT", "First aid kit"],
  ["SMOKE_DETECTOR", "Smoke detector"],
  ["AED", "Automated external defibrillator"],
  ["SECURITY_STATION", "Security station"],
  ["EMERGENCY_LIGHTING", "Emergency lighting"],
];

const EVENT_SAFETY_CONSIDERATIONS = [
  ["FIRE_SAFETY_COMPLIANCE", "Fire safety compliance"],
  ["EMERGENCY_PLAN", "Emergency plan"],
  ["CROWD_MANAGEMENT", "Crowd management"],
  ["MEDICAL_SUPPORT", "Medical support"],
  ["STRUCTURAL_INTEGRITY", "Structural integrity"],
  ["ACCESSIBILITY_SAFETY", "Accessibility safety"],
  ["INCIDENT_REPORTING", "Incident reporting"],
];

const optionSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    enabled: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const makeOptions = (options, featured = []) =>
  options.map(([key, label], index) => ({
    key,
    label,
    enabled: true,
    featured: featured.includes(key),
    sortOrder: index,
  }));

const eventSettingsSchema = new Schema(
  {
    key: { type: String, default: "event_settings", unique: true },
    general: {
      eventCreationEnabled: { type: Boolean, default: true },
      draftsEnabled: { type: Boolean, default: true },
      defaultTimezone: { type: String, default: "Africa/Lagos", maxlength: 80 },
      defaultCurrency: { type: String, default: "NGN", maxlength: 3 },
    },
    publishing: {
      autoPublishVerifiedOrganisers: { type: Boolean, default: true },
      requireIdentityVerification: { type: Boolean, default: true },
      requirePayoutAccount: { type: Boolean, default: true },
      requireCoverImage: { type: Boolean, default: false },
      minLeadTimeHours: { type: Number, default: 0, min: 0, max: 8760 },
      maxDurationDays: { type: Number, default: 30, min: 1, max: 365 },
    },
    contentLimits: {
      maxTitleLength: { type: Number, default: 50, min: 10, max: 50 },
      maxShortDescriptionLength: {
        type: Number,
        default: 500,
        min: 50,
        max: 500,
      },
      maxDescriptionLength: {
        type: Number,
        default: 250,
        min: 50,
        max: 250,
      },
      maxImages: { type: Number, default: 10, min: 1, max: 30 },
      maxHighlights: { type: Number, default: 12, min: 1, max: 50 },
      maxPerformers: { type: Number, default: 50, min: 1, max: 100 },
    },
    ticketing: {
      freeEventsEnabled: { type: Boolean, default: true },
      paidEventsEnabled: { type: Boolean, default: true },
      onSiteTicketsEnabled: { type: Boolean, default: true },
      requireRefundPolicyForPaidEvents: { type: Boolean, default: false },
      maxTicketTiers: { type: Number, default: 20, min: 1, max: 100 },
      maxTicketsPerOrder: { type: Number, default: 20, min: 1, max: 1000 },
      salesCutoffMinutes: { type: Number, default: 0, min: 0, max: 10080 },
    },
    lifecycle: {
      autoCompletePastEvents: { type: Boolean, default: true },
      completionGraceHours: { type: Number, default: 0, min: 0, max: 168 },
    },
    guidance: {
      defaultRefundPolicy: { type: String, default: "", maxlength: 500 },
      defaultArrivalNotes: { type: String, default: "", maxlength: 1000 },
      defaultParkingInformation: { type: String, default: "", maxlength: 500 },
      defaultCheckInInstructions: {
        type: String,
        default: "",
        maxlength: 1000,
      },
    },
    categories: {
      type: [optionSchema],
      default: () =>
        makeOptions(EVENT_CATEGORIES, [
          "MUSIC_CONCERTS",
          "FESTIVALS_FAIRS",
          "FOOD_DRINK",
          "BUSINESS_NETWORKING",
          "TECHNOLOGY_INNOVATION",
        ]),
    },
    amenities: {
      type: [optionSchema],
      default: () => makeOptions(EVENT_AMENITIES),
    },
    safetyOptions: {
      type: [optionSchema],
      default: () => makeOptions(EVENT_SAFETY_OPTIONS),
    },
    safetyConsiderations: {
      type: [optionSchema],
      default: () => makeOptions(EVENT_SAFETY_CONSIDERATIONS),
    },
  },
  { timestamps: true },
);

eventSettingsSchema.statics.getSingleton = function () {
  return this.findOneAndUpdate(
    { key: "event_settings" },
    { $setOnInsert: { key: "event_settings" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

const EventSettings = model("EventSettings", eventSettingsSchema);

EventSettings.EVENT_CATEGORIES = EVENT_CATEGORIES;
EventSettings.EVENT_AMENITIES = EVENT_AMENITIES;
EventSettings.EVENT_SAFETY_OPTIONS = EVENT_SAFETY_OPTIONS;
EventSettings.EVENT_SAFETY_CONSIDERATIONS = EVENT_SAFETY_CONSIDERATIONS;

module.exports = EventSettings;
