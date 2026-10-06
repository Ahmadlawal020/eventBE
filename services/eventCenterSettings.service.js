const EventCenterSettings = require("../models/management/eventCenterSettings.schema");

const getEventCenterSettings = () => EventCenterSettings.getSingleton();


const validateVenuePayload = (
  payload,
  settings,
  { publishing = false, requireComplete = publishing, existing = false, changes = payload } = {},
) => {
  const errors = [];
  const shouldValidate = (field) =>
    !existing ||
    publishing ||
    Object.prototype.hasOwnProperty.call(changes, field);

  if (!existing && !settings.general.venueCreationEnabled) {
    errors.push("Venue creation is temporarily disabled");
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
  if (publishing && payload.images?.length > limits.maxImages) {
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

  if (shouldValidate("capacity") && payload.capacity?.max !== undefined &&
      (!Number.isInteger(payload.capacity.max) || payload.capacity.max <= 0)) {
    errors.push("Capacity must be a positive whole number");
  }
  for (const field of ["basePrice", "weekendPrice"]) {
    const price = payload[field];
    if (shouldValidate(field) && price?.amount !== undefined &&
        (!Number.isFinite(price.amount) || price.amount < 0)) {
      errors.push("Price must be a finite non-negative number");
    }
  }

  if (shouldValidate("basePrice") && payload.basePrice?.amount !== undefined) {
    const currency = payload.basePrice?.currency || "NGN";
    const minRequired =
      settings.pricing.minimumBasePrices?.[currency] ??
      settings.pricing.minimumBasePrices?.get?.(currency) ??
      settings.pricing.minimumBasePrice ??
      0;
    if (Number(payload.basePrice.amount) < minRequired) {
      errors.push(`Base price for ${currency} must be at least ${minRequired}`);
    }
  }

  if (requireComplete) {
    for (const [field, label] of [
      ["venueName", "Venue name"], ["venueType", "Venue type"],
      ["shortDescription", "Short description"], ["description", "Description"],
    ]) {
      if (typeof payload[field] !== "string" || !payload[field].trim()) {
        errors.push(label + " is required before publishing");
      }
    }
    if (!Array.isArray(payload.supportedEvents) || !payload.supportedEvents.length) {
      errors.push("At least one supported event type is required before publishing");
    }
    if (!Number.isInteger(payload.capacity?.max) || payload.capacity.max <= 0) {
      errors.push("A valid maximum capacity is required before publishing");
    }
    if (
      !Array.isArray(payload.images) ||
      payload.images.length < settings.publishing.minimumImages
    ) {
      errors.push(
        `At least ${settings.publishing.minimumImages} property images are required before publishing`,
      );
    }
    if (
      !Array.isArray(payload.safety) ||
      payload.safety.length < settings.publishing.minimumSafetyItems
    ) {
      errors.push(
        `At least ${settings.publishing.minimumSafetyItems} safety & security items are required before publishing`,
      );
    }
    if (payload.basePrice?.amount !== undefined) {
      const amount = payload.basePrice?.amount;
      const currency = payload.basePrice?.currency || "NGN";
      const minRequired =
        settings.pricing?.minimumBasePrices?.[currency] ??
        settings.pricing?.minimumBasePrices?.get?.(currency) ??
        settings.pricing?.minimumBasePrice ??
        0;
      if (!Number.isFinite(amount) || amount < minRequired) {
        errors.push(
          `Base price for ${currency} must be at least ${minRequired}`,
        );
      }
    }
  }

  return errors;
};

const ownerMeetsPublishingRequirements = (user, settings) => {
  if (
    settings.publishing.requireIdentityVerification &&
    !user?.isIdentityVerified
  ) {
    return false;
  }
  const hasPayoutAccount = Boolean(
    user?.vendorAccountCode ||
    (user?.bankDetails?.accountNumber && user?.bankDetails?.bankCode)
  );
  const requirePayout = settings.publishing.requirePayoutAccount !== false;
  if (requirePayout && !hasPayoutAccount) {
    return false;
  }
  return true;
};

const publicEventCenterSettings = (settings) => ({
  general: settings.general,
  publishing: settings.publishing,
  contentLimits: settings.contentLimits,
  booking: settings.booking,
  pricing: settings.pricing,
  updatedAt: settings.updatedAt,
});

module.exports = {
  getEventCenterSettings,
  ownerMeetsPublishingRequirements,
  publicEventCenterSettings,
  validateVenuePayload,
};
