const mongoose = require("mongoose");

// 🔑 Enum keys + human-readable labels
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

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    image: {
      type: String,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 250,
    },

    // 🔑 Safe enum keys only
    eventType: {
      type: String,
      enum: Object.keys(eventLabels), // e.g. "MUSIC_CONCERTS"
      // required: true,
    },

    ageRestriction: {
      minAge: {
        type: Number,
        min: 0,
      },
      maxAge: {
        type: Number,
        min: 0,
      },
    },

    schedule: {
      from: {
        type: Date,
      },
      to: {
        type: Date,
      },
    },
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
        latitude: {
          type: Number,
        },
        longitude: {
          type: Number,
        },
      },

      // Privacy toggle from UI
      isSpecificLocation: {
        type: Boolean,
        default: false,
      },
    },

    capacity: {
      type: Number,
      min: 0,
    },

    isDraft: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// 🔎 Automatically attach human-readable label in API responses
eventSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.eventTypeLabel = eventLabels[obj.eventType];
  return obj;
};

module.exports = mongoose.model("Event", eventSchema);
module.exports.eventLabels = eventLabels;
