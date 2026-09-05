const EventCenterSettings = require("../models/management/eventCenterSettings.schema");

const getEventCenterSettings = () => EventCenterSettings.getSingleton();

const enabledKeys = (options = []) =>
  new Set(
    options.filter((option) => option.enabled).map((option) => option.key),
  );

const validateVenuePayload = (
  payload,
  settings,
  { publishing = false, existing = false, changes = payload } = {},
) => {
  const errors = [];
  const shouldValidate = (field) =>
    !existing ||
    publishing ||
    Object.prototype.hasOwnProperty.call(changes, field);

  if (!existing && !settings.general.venueCreationEnabled) {
    errors.push("Venue creation is temporarily disabled");
  }
  if (
    !existing &&
    payload.isDraft !== false &&
    !settings.general.draftsEnabled
  ) {
    errors.push("Draft venues are currently disabled");
  }

  const validateOptions = (values, options, label) => {
    if (!Array.isArray(values)) return;
    const enabled = enabledKeys(options);
    const unavailable = values.find((value) => !enabled.has(value));
    if (unavailable)
      errors.push(`${label} option ${unavailable} is not available`);
  };

  if (payload.venueType && shouldValidate("venueType")) {
    if (!enabledKeys(settings.venueTypes).has(payload.venueType)) {
      errors.push("The selected venue type is not available");
    }
  }
  if (shouldValidate("amenities")) {
    validateOptions(payload.amenities, settings.amenities, "Amenity");
  }
  if (shouldValidate("venueRules")) {
    validateOptions(payload.venueRules, settings.venueRules, "Venue rule");
  }
  if (shouldValidate("safety")) {
    validateOptions(payload.safety, settings.safetyOptions, "Safety");
  }
  if (shouldValidate("safetyConsiderations")) {
    validateOptions(
      payload.safetyConsiderations,
      settings.safetyConsiderations,
      "Safety consideration",
    );
  }
  if (shouldValidate("discounts")) {
    validateOptions(payload.discounts, settings.discounts, "Discount");
  }

  const limits = settings.contentLimits;
  const validateLength = (value, maximum, label) => {
    if (typeof value === "string" && value.length > maximum) {
      errors.push(`${label} cannot exceed ${maximum} characters`);
    }
  };
  if (shouldValidate("venueName")) {
    validateLength(payload.venueName, limits.maxVenueNameLength, "Venue name");
  }
  if (shouldValidate("shortDescription")) {
    validateLength(
      payload.shortDescription,
      limits.maxShortDescriptionLength,
      "Short description",
    );
  }
  if (shouldValidate("description")) {
    validateLength(
      payload.description,
      limits.maxDescriptionLength,
      "Description",
    );
  }
  if (shouldValidate("images") && payload.images?.length > limits.maxImages) {
    errors.push(`A venue can have at most ${limits.maxImages} images`);
  }
  if (
    shouldValidate("customVenueRules") &&
    payload.customVenueRules?.length > limits.maxCustomRules
  ) {
    errors.push(
      `A venue can have at most ${limits.maxCustomRules} custom rules`,
    );
  }

  if (
    shouldValidate("bookingSettings") &&
    payload.bookingSettings === "INSTANT" &&
    !settings.booking.instantBookingEnabled
  ) {
    errors.push("Instant booking is currently disabled");
  }
  if (
    shouldValidate("bookingSettings") &&
    payload.bookingSettings === "REVIEW" &&
    !settings.booking.reviewBookingEnabled
  ) {
    errors.push("Request-to-book is currently disabled");
  }
  if (
    shouldValidate("weekendPrice") &&
    payload.weekendPrice?.amount !== undefined &&
    !settings.pricing.weekendPricingEnabled
  ) {
    errors.push("Weekend pricing is currently disabled");
  }
  if (
    shouldValidate("discounts") &&
    payload.discounts?.length &&
    !settings.pricing.discountsEnabled
  ) {
    errors.push("Venue discounts are currently disabled");
  }

  if (publishing) {
    if ((payload.images?.length || 0) < settings.publishing.minimumImages) {
      errors.push(
        `At least ${settings.publishing.minimumImages} venue images are required`,
      );
    }
    if (
      (payload.safety?.length || 0) < settings.publishing.minimumSafetyItems
    ) {
      errors.push(
        `At least ${settings.publishing.minimumSafetyItems} safety items are required`,
      );
    }
    if (
      settings.publishing.requireSpecificLocation &&
      !payload.location?.isSpecificLocation
    ) {
      errors.push("A specific venue location is required before publishing");
    }
    if (settings.pricing.requireBasePrice) {
      const amount = payload.basePrice?.amount;
      if (amount === undefined || amount < settings.pricing.minimumBasePrice) {
        errors.push(
          `Base price must be at least ${settings.pricing.minimumBasePrice}`,
        );
      }
    }
  }

  return errors;
};

const ownerMeetsPublishingRequirements = (user, settings) =>
  (!settings.publishing.requireIdentityVerification ||
    Boolean(user?.isIdentityVerified)) &&
  (!settings.publishing.requirePhoneVerification ||
    Boolean(user?.isPhoneVerified));

const publicEventCenterSettings = (settings) => {
  const publicOptions = (options) =>
    options
      .filter((option) => option.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    general: settings.general,
    publishing: settings.publishing,
    contentLimits: settings.contentLimits,
    booking: settings.booking,
    pricing: settings.pricing,
    venueTypes: publicOptions(settings.venueTypes),
    amenities: publicOptions(settings.amenities),
    venueRules: publicOptions(settings.venueRules),
    safetyOptions: publicOptions(settings.safetyOptions),
    safetyConsiderations: publicOptions(settings.safetyConsiderations),
    discounts: publicOptions(settings.discounts),
    updatedAt: settings.updatedAt,
  };
};

module.exports = {
  getEventCenterSettings,
  ownerMeetsPublishingRequirements,
  publicEventCenterSettings,
  validateVenuePayload,
};
