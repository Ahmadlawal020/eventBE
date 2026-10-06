const EventSettings = require("../models/management/eventSettings.schema");

const getEventSettings = () => EventSettings.getSingleton();
const getEffectiveEventSettings = async (locationId = null) => {
  const settings = await getEventSettings();
  const { values } = await require("./management/geography.service").settingsFor(locationId ? String(locationId) : "global");
  const result = settings.toObject();
  result.general.defaultTimezone = values.defaultTimezone;
  result.general.defaultCurrency = values.defaultCurrency;
  result.ticketing.onSiteTicketsEnabled = values.onSiteTicketsEnabled;
  result.ticketing.maxTicketsPerOrder = values.maxTicketsPerOrder;
  return result;
};

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

  if (publishing && payload.images?.length > limits.maxImages) {
    errors.push(`An event can have at most ${limits.maxImages} images`);
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
    if (payload.schedule?.timeZone !== undefined) {
      try { new Intl.DateTimeFormat("en", { timeZone: payload.schedule.timeZone }).format(); }
      catch { errors.push("Choose a valid event timezone"); }
    }

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
    const requiredImages = Math.max(
      settings.publishing.requireCoverImage ? 1 : 0,
      settings.publishing.minimumImages ?? 0,
      settings.contentLimits?.minImages ?? 0,
    );
    if (requiredImages > 0 && (!payload.images || payload.images.length < requiredImages)) {
      errors.push(
        requiredImages === 1
          ? "A cover image is required before publishing"
          : `At least ${requiredImages} images are required before publishing`,
      );
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
  schedule: { ...payload.schedule, timeZone: payload.schedule?.timeZone || settings.general.defaultTimezone },
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
  general: { eventCreationEnabled: settings.general.eventCreationEnabled, defaultTimezone: settings.general.defaultTimezone, defaultCurrency: settings.general.defaultCurrency },
  publishing: settings.publishing,
  contentLimits: settings.contentLimits,
  ticketing: settings.ticketing,
  pricing: settings.pricing,
  guidance: settings.guidance,
  updatedAt: settings.updatedAt,
});

const getTicketMinBasePrice = (pricing, currencyCode = "NGN") => {
  const code = (currencyCode || "NGN").toUpperCase();
  const minRequired =
    pricing?.minimumBasePrices?.[code] ??
    pricing?.minimumBasePrices?.get?.(code) ??
    pricing?.minimumBasePrice ??
    0;
  return Number(minRequired) || 0;
};

module.exports = {
  applyGuidanceDefaults,
  getEventSettings,
  getEffectiveEventSettings,
  getTicketMinBasePrice,
  organiserMeetsPublishingRequirements,
  publicEventSettings,
  validateEventPayload,
};
