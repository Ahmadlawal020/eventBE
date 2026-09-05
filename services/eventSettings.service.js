const EventSettings = require("../models/management/eventSettings.schema");

const getEventSettings = () => EventSettings.getSingleton();

const enabledKeys = (options = []) =>
  new Set(
    options.filter((option) => option.enabled).map((option) => option.key),
  );

const validateEventPayload = (
  payload,
  settings,
  { publishing = false, existing = false, changes = payload } = {},
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

  const startsAt = payload.schedule?.from
    ? new Date(payload.schedule.from)
    : undefined;
  const endsAt = payload.schedule?.to
    ? new Date(payload.schedule.to)
    : undefined;

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

  if (publishing) {
    if (settings.publishing.requireCoverImage && !payload.images?.length) {
      errors.push("A cover image is required before publishing");
    }
    if (
      settings.publishing.requireSpecificLocation &&
      !payload.location?.isSpecificLocation
    ) {
      errors.push("A specific event location is required before publishing");
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
  if (settings.publishing.requirePhoneVerification && !user?.isPhoneVerified) {
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
