const { Schema, model } = require("mongoose");

const VENUE_TYPES = [
  ["CONVENTION_CENTER", "Convention center"],
  ["CONFERENCE_HALL", "Conference hall"],
  ["BANQUET_HALL", "Banquet hall"],
  ["HOTEL_VENUE", "Hotel venue"],
  ["THEATER_AUDITORIUM", "Theater & auditorium"],
  ["STADIUM_ARENA", "Stadium & arena"],
  ["OUTDOOR_VENUE", "Outdoor venue"],
  ["COMMUNITY_CENTER", "Community center"],
  ["ART_GALLERY_MUSEUM", "Art gallery & museum"],
  ["CLUB_LOUNGE", "Club & lounge"],
  ["RELIGIOUS_VENUE", "Religious venue"],
  ["MULTIPURPOSE_SPACE", "Multipurpose space"],
];

const AMENITIES = [
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

const VENUE_RULES = [
  ["NO_SMOKING", "No smoking"],
  ["NO_ALCOHOL", "No alcohol"],
  ["NO_LOUD_MUSIC", "No loud music"],
  ["NO_OUTSIDE_FOOD", "No outside food"],
  ["NO_PETS", "No pets"],
  ["CHILD_FRIENDLY", "Child friendly"],
  ["SECURITY_REQUIRED", "Security required"],
  ["TIME_RESTRICTION", "Time restriction"],
  ["CATERING_IN_HOUSE", "In-house catering"],
  ["CATERING_OUTSIDE_ALLOWED", "Outside catering allowed"],
  ["NO_GLITTER_CONFETTI", "No glitter or confetti"],
  ["ALCOHOL_LICENSE_REQUIRED", "Alcohol licence required"],
];

const SAFETY_OPTIONS = [
  ["FIRE_EXTINGUISHER", "Fire extinguisher"],
  ["EMERGENCY_EXIT", "Emergency exit"],
  ["CCTV", "CCTV"],
  ["FIRST_AID_KIT", "First aid kit"],
  ["SMOKE_DETECTOR", "Smoke detector"],
  ["AED", "Automated external defibrillator"],
  ["SECURITY_STATION", "Security station"],
  ["EMERGENCY_LIGHTING", "Emergency lighting"],
];

const SAFETY_CONSIDERATIONS = [
  ["FIRE_SAFETY_COMPLIANCE", "Fire safety compliance"],
  ["EMERGENCY_PLAN", "Emergency plan"],
  ["CROWD_MANAGEMENT", "Crowd management"],
  ["MEDICAL_SUPPORT", "Medical support"],
  ["STRUCTURAL_INTEGRITY", "Structural integrity"],
  ["ACCESSIBILITY_SAFETY", "Accessibility safety"],
  ["INCIDENT_REPORTING", "Incident reporting"],
];

const DISCOUNTS = [
  ["MULTI_DAY", "Multi-day"],
  ["EARLY_BIRD", "Early bird"],
  ["OFF_PEAK", "Off-peak"],
  ["NON_PROFIT", "Non-profit"],
  ["LOYALTY", "Loyalty"],
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

const makeOptions = (options) =>
  options.map(([key, label], index) => ({
    key,
    label,
    enabled: true,
    featured: false,
    sortOrder: index,
  }));

const eventCenterSettingsSchema = new Schema(
  {
    key: { type: String, default: "event_center_settings", unique: true },
    general: {
      venueCreationEnabled: { type: Boolean, default: true },
    },
    publishing: {
      autoPublishVerifiedOwners: { type: Boolean, default: true },
      requireIdentityVerification: { type: Boolean, default: true },
      requirePayoutAccount: { type: Boolean, default: true },
      minimumImages: { type: Number, default: 0, min: 0, max: 30 },
      minimumSafetyItems: { type: Number, default: 0, min: 0, max: 8 },
    },
    contentLimits: {
      maxVenueNameLength: { type: Number, default: 100, min: 20, max: 100 },
      maxShortDescriptionLength: {
        type: Number,
        default: 250,
        min: 50,
        max: 300,
      },
      maxDescriptionLength: {
        type: Number,
        default: 1000,
        min: 100,
        max: 2000,
      },
      minImages: { type: Number, default: 1, min: 0, max: 30 },
      maxImages: { type: Number, default: 20, min: 1, max: 50 },
      maxCustomRules: { type: Number, default: 20, min: 0, max: 50 },
    },
    booking: {
      instantBookingEnabled: { type: Boolean, default: true },
      reviewBookingEnabled: { type: Boolean, default: true },
      defaultBookingMode: {
        type: String,
        enum: ["INSTANT", "REVIEW"],
        default: "INSTANT",
      },
      maximumBookingDate: {
        type: String,
        default: null,
        validate: {
          validator: (value) => {
            if (value === null || value === undefined) return true;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
            const date = new Date(`${value}T00:00:00.000Z`);
            return Number.isFinite(date.getTime()) &&
              date.toISOString().slice(0, 10) === value;
          },
          message: "Select a valid maximum booking date",
        },
      },
      maximumBookingWindowMonths: {
        type: Number,
        enum: [3, 6, 9, 12, 18, 24, 36],
        default: 12,
      },
    },
    pricing: {
      feeCollectionMode: {
        type: String,
        enum: ["ORGANISER_CHOICE", "PASS_TO_BUYER", "ABSORB_BY_ORGANISER"],
        default: "ORGANISER_CHOICE",
      },

      minimumBasePrice: { type: Number, default: 0, min: 0 },
      minimumBasePrices: {
        NGN: { type: Number, default: 0, min: 0 },
        USD: { type: Number, default: 0, min: 0 },
        EUR: { type: Number, default: 0, min: 0 },
        GBP: { type: Number, default: 0, min: 0 },
        AED: { type: Number, default: 0, min: 0 },
        SAR: { type: Number, default: 0, min: 0 },
        GHS: { type: Number, default: 0, min: 0 },
        KES: { type: Number, default: 0, min: 0 },
        ZAR: { type: Number, default: 0, min: 0 },
      },
    },
  },
  { timestamps: true },
);

eventCenterSettingsSchema.statics.getSingleton = function () {
  return this.findOneAndUpdate(
    { key: "event_center_settings" },
    { $setOnInsert: { key: "event_center_settings" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

const EventCenterSettings = model(
  "EventCenterSettings",
  eventCenterSettingsSchema,
);
EventCenterSettings.VENUE_TYPES = VENUE_TYPES;
EventCenterSettings.AMENITIES = AMENITIES;
EventCenterSettings.VENUE_RULES = VENUE_RULES;
EventCenterSettings.SAFETY_OPTIONS = SAFETY_OPTIONS;
EventCenterSettings.SAFETY_CONSIDERATIONS = SAFETY_CONSIDERATIONS;
EventCenterSettings.DISCOUNTS = DISCOUNTS;

module.exports = EventCenterSettings;
