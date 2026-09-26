const EventSettings = require("../models/management/eventSettings.schema");

const getEventSettings = () => EventSettings.getSingleton();

const enabledKeys = (options = []) =>
  new Set(
    options.filter((option) => option.enabled).map((option) => option.key),
  );

const validateEventPayload = (
  payload,
  settings,
  { publishing = false, requireComplete = publishing, existing = false, changes = payload } = {},
) => {
  const errors = [];
  const limits = settings.contentLimits;
  const shouldValidate = (field) =>
    !existing ||
    publishing ||
    Object.prototype.hasOwnProperty.call(changes, field);

  if (!existing && !settings.general.eventCreationEnabled) {
    errors.push("Event creation is temporarily disabled");
  }
  if (
    !existing &&
    payload.isDraft !== false &&
    !settings.general.draftsEnabled
  ) {
    errors.push("Draft events are currently disabled");
  }

  if (payload.eventType && shouldValidate("eventType")) {
    const categories = enabledKeys(settings.categories);
    if (!categories.has(payload.eventType)) {
      errors.push("The selected event category is not available");
    }
  }

  const validateOptions = (values, options, label) => {
    if (!Array.isArray(values)) return;
    const enabled = enabledKeys(options);
    const unavailable = values.find((value) => !enabled.has(value));
    if (unavailable)
      errors.push(`${label} option ${unavailable} is not available`);
  };

  if (shouldValidate("amenities")) {
    validateOptions(payload.amenities, settings.amenities, "Amenity");
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

  const validateLength = (value, maximum, label) => {
    if (typeof value === "string" && value.length > maximum) {
      errors.push(`${label} cannot exceed ${maximum} characters`);
    }
  };
  if (shouldValidate("title")) {
    validateLength(payload.title, limits.maxTitleLength, "Title");
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
    errors.push(`An event can have at most ${limits.maxImages} images`);
  }
  if (
    shouldValidate("highlights") &&
    payload.highlights?.length > limits.maxHighlights
  ) {
    errors.push(`An event can have at most ${limits.maxHighlights} highlights`);
  }
  if (
    shouldValidate("performers") &&
    payload.performers?.length > limits.maxPerformers
  ) {
    errors.push(`An event can have at most ${limits.maxPerformers} performers`);
  }

  if (
    shouldValidate("entry") &&
    payload.entry?.onSiteTickets === true &&
    !settings.ticketing.onSiteTicketsEnabled
  ) {
    errors.push("On-site ticket sales are currently disabled");
  }

  if (shouldValidate("ageRestriction")) {
    const { minAge, maxAge } = payload.ageRestriction || {};
    for (const age of [minAge, maxAge]) {
      if (age !== undefined && (!Number.isInteger(age) || age < 0)) {
        errors.push("Ages must be non-negative whole numbers");
        break;
      }
    }
    if (minAge !== undefined && maxAge !== undefined && maxAge < minAge) {
      errors.push("Maximum age cannot be below minimum age");
    }
  }

  const startsAt = payload.schedule?.from
    ? new Date(payload.schedule.from)
    : undefined;
  const endsAt = payload.schedule?.to
    ? new Date(payload.schedule.to)
    : undefined;

  if (shouldValidate("schedule")) {
    for (const value of [payload.schedule?.from, payload.schedule?.to]) {
      if (value !== undefined && (!value || !Number.isFinite(new Date(value).getTime()))) {
        errors.push("Event dates must be valid dates");
        break;
      }
    }
  }

  if (shouldValidate("schedule") && startsAt && endsAt) {
    if (endsAt <= startsAt)
      errors.push("Event end time must be after its start time");
    const durationMs = endsAt.getTime() - startsAt.getTime();
    if (durationMs > settings.publishing.maxDurationDays * 86400000) {
      errors.push(
        `Event duration cannot exceed ${settings.publishing.maxDurationDays} days`,
      );
    }
  }

  if (requireComplete) {
    for (const [field, label] of [
      ["title", "Title"], ["eventType", "Event type"],
      ["shortDescription", "Short description"], ["description", "Description"],
    ]) {
      if (typeof payload[field] !== "string" || !payload[field].trim()) {
        errors.push(label + " is required before publishing");
      }
    }
    if (!startsAt || !endsAt || !Number.isFinite(startsAt.getTime()) ||
        !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      errors.push("A valid start and end date are required before publishing");
    }
    const loc = payload.location;
    if (!loc || !["addressString", "street", "city", "country"].every(
      (field) => typeof loc[field] === "string" && loc[field].trim(),
    ) || !Number.isFinite(loc.coordinates?.latitude) ||
        !Number.isFinite(loc.coordinates?.longitude) ||
        Math.abs(loc.coordinates.latitude) > 90 || Math.abs(loc.coordinates.longitude) > 180) {
      errors.push("A complete event location is required before publishing");
    }
  }

  if (publishing) {
    if (settings.publishing.requireCoverImage && !payload.images?.length) {
      errors.push("A cover image is required before publishing");
    }
    if (startsAt) {
      const minimumStart =
        Date.now() + settings.publishing.minLeadTimeHours * 3600000;
      if (startsAt.getTime() < minimumStart) {
        errors.push(
          `Events must be published at least ${settings.publishing.minLeadTimeHours} hours before they start`,
        );
      }
    }
  }

  return errors;
};

const applyGuidanceDefaults = (payload, settings) => ({
  ...payload,
  ticketGuide: {
    ...payload.ticketGuide,
    refundPolicy:
      payload.ticketGuide?.refundPolicy ||
      settings.guidance.defaultRefundPolicy,
  },
  arrivalGuide: {
    ...payload.arrivalGuide,
    notes: payload.arrivalGuide?.notes || settings.guidance.defaultArrivalNotes,
    parking:
      payload.arrivalGuide?.parking ||
      settings.guidance.defaultParkingInformation,
    checkInInstructions:
      payload.arrivalGuide?.checkInInstructions ||
      settings.guidance.defaultCheckInInstructions,
  },
});

const organiserMeetsPublishingRequirements = (user, settings) => {
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

const publicEventSettings = (settings) => ({
  general: settings.general,
  publishing: settings.publishing,
  contentLimits: settings.contentLimits,
  ticketing: settings.ticketing,
  guidance: settings.guidance,
  categories: settings.categories
    .filter((option) => option.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder),
  amenities: settings.amenities
    .filter((option) => option.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder),
  safetyOptions: settings.safetyOptions
    .filter((option) => option.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder),
  safetyConsiderations: settings.safetyConsiderations
    .filter((option) => option.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder),
  updatedAt: settings.updatedAt,
});

module.exports = {
  applyGuidanceDefaults,
  getEventSettings,
  organiserMeetsPublishingRequirements,
  publicEventSettings,
  validateEventPayload,
};
