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

// Clears refund fields that do not belong to the selected policy type so a
// stored ticketGuide can never hold contradictory terms.
const normalizeTicketGuide = (guide) => {
  if (!guide || typeof guide !== "object" || Array.isArray(guide)) return guide;
  const normalized = { ...guide };
  for (const field of ["customRefundTerms", "cancellationNotificationMethod",
    "cancellationRefundProcess", "cancellationRefundTimeline"]) {
    if (typeof normalized[field] === "string") normalized[field] = normalized[field].trim();
  }
  if (normalized.refundPolicyType === "NO_REFUNDS") {
    normalized.refundWindowDays = null;
    normalized.refundAmountType = null;
    normalized.partialRefundPercentage = null;
    normalized.customRefundTerms = null;
  } else if (normalized.refundPolicyType === "REFUNDS_BEFORE_EVENT") {
    normalized.customRefundTerms = null;
    if (normalized.refundAmountType === "FULL") {
      normalized.partialRefundPercentage = null;
    }
  } else if (normalized.refundPolicyType === "CUSTOM") {
    normalized.refundWindowDays = null;
    normalized.refundAmountType = null;
    normalized.partialRefundPercentage = null;
  }
  return normalized;
};

// Keep the two-field creation form compatible with existing ticket-guide readers.
// Only explicit policy edits are mirrored; unrelated listing patches stay untouched.
const normalizeEventCancellationPolicy = (payload, previous = {}) => {
  const fields = ["cancellationRefundProcess", "cancellationRefundTimeline"];
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const topLevelEdit = fields.some((field) => hasOwn(payload, field));
  const nestedEdit = fields.some((field) => hasOwn(payload.ticketGuide || {}, field));
  if (!topLevelEdit && !nestedEdit) return payload;
  const result = { ...payload };
  const guide = { ...previous.ticketGuide, ...payload.ticketGuide };
  if (topLevelEdit) {
    Object.assign(guide, {
      platformPolicyAcknowledged: true,
      refundPolicyType: "NO_REFUNDS",
      cancellationNotificationMethod: "Email and in-app notification",
    });
  }
  for (const field of fields) {
    const value = topLevelEdit
      ? (hasOwn(payload, field) ? payload[field] : previous[field] ?? guide[field])
      : guide[field];
    if (value !== undefined) {
      result[field] = typeof value === "string" ? value.trim() : value;
      guide[field] = result[field];
    }
  }
  result.ticketGuide = normalizeTicketGuide(guide);
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

  if (shouldValidate("images") && payload.images?.length > limits.maxImages) {
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

  // Terms are always required for publishing. They are also re-checked whenever
  // an existing, non-draft listing receives a ticketGuide patch, so terms can
  // never be cleared or emptied on a live listing without validation.
  const ticketGuidePatched =
    existing && Object.prototype.hasOwnProperty.call(changes, "ticketGuide");
  const guide = payload.ticketGuide;
  const hasText = (value) => typeof value === "string" && Boolean(value.trim());
  if (shouldValidate("ticketGuide") && guide !== undefined) {
    if (!guide || typeof guide !== "object" || Array.isArray(guide)) {
      errors.push("Refund and cancellation policy must be an object");
    } else {
      for (const [field, maximum] of [
        ["customRefundTerms", 1000], ["cancellationNotificationMethod", 500],
        ["cancellationRefundProcess", 1000], ["cancellationRefundTimeline", 500],
      ]) {
        if (guide[field] != null && typeof guide[field] !== "string") {
          errors.push(field + " must be text");
        }
        validateLength(guide[field], maximum, field);
      }
      if (guide.platformPolicyAcknowledged != null && typeof guide.platformPolicyAcknowledged !== "boolean") {
        errors.push("Platform policy acknowledgement must be a boolean");
      }
      if (guide.refundPolicyType != null && !["NO_REFUNDS", "REFUNDS_BEFORE_EVENT", "CUSTOM"].includes(guide.refundPolicyType)) {
        errors.push("Choose a valid attendee refund policy");
      }
      if (guide.refundAmountType != null && !["FULL", "PARTIAL"].includes(guide.refundAmountType)) {
        errors.push("Choose whether the refund is full or partial");
      }
      if (guide.refundWindowDays != null &&
          (!Number.isInteger(guide.refundWindowDays) || guide.refundWindowDays < 1 || guide.refundWindowDays > 365)) {
        errors.push("Refund window must be a whole number between 1 and 365 days");
      }
      if (guide.partialRefundPercentage != null &&
          (!Number.isFinite(guide.partialRefundPercentage) || guide.partialRefundPercentage < 1 || guide.partialRefundPercentage > 99)) {
        errors.push("Choose a partial refund percentage between 1 and 99");
      }
    }
  }
  for (const [field, maximum] of [
    ["cancellationRefundProcess", 1000], ["cancellationRefundTimeline", 500],
  ]) {
    if (shouldValidate(field) && payload[field] !== undefined &&
        (typeof payload[field] !== "string" || payload[field].length > maximum)) {
      errors.push(field + " must be text of at most " + maximum + " characters");
    }
  }
  const termsRequired =
    requireComplete || (ticketGuidePatched && payload.status !== "IN_PROGRESS");

  if (termsRequired) {
    const policy = payload.ticketGuide;
    if (policy?.platformPolicyAcknowledged !== true) {
      errors.push("Acknowledge the platform non-refundable-fees policy before publishing");
    }
    if (!["NO_REFUNDS", "REFUNDS_BEFORE_EVENT", "CUSTOM"].includes(policy?.refundPolicyType)) {
      errors.push("Choose an attendee refund policy before publishing");
    } else if (policy.refundPolicyType === "REFUNDS_BEFORE_EVENT") {
      if (!Number.isInteger(policy.refundWindowDays) || policy.refundWindowDays < 1) {
        errors.push("Choose a valid refund window before publishing");
      } else if (policy.refundWindowDays > 365) {
        errors.push("Refund window cannot exceed 365 days");
      }
      if (!["FULL", "PARTIAL"].includes(policy.refundAmountType)) {
        errors.push("Choose whether the refund is full or partial before publishing");
      } else if (
        policy.refundAmountType === "PARTIAL" &&
        (!Number.isFinite(policy.partialRefundPercentage) ||
          policy.partialRefundPercentage < 1 ||
          policy.partialRefundPercentage > 99)
      ) {
        errors.push("Choose a partial refund percentage between 1 and 99");
      }
    } else if (
      policy.refundPolicyType === "CUSTOM" &&
      !hasText(policy?.customRefundTerms)
    ) {
      errors.push("Enter your custom refund terms before publishing");
    }
    if (!hasText(policy?.cancellationNotificationMethod)) {
      errors.push("Explain how attendees will be notified if the event is cancelled");
    }
    if (!hasText(policy?.cancellationRefundProcess)) {
      errors.push("Explain how eligible manual refunds will be triggered");
    }
    if (!hasText(policy?.cancellationRefundTimeline)) {
      errors.push("Provide a refund processing timeline for event cancellations");
    }
  }

  if (publishing || (payload.status === "LISTED" && shouldValidate("images"))) {
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
    if (publishing && startsAt) {
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
  normalizeTicketGuide,
  normalizeEventCancellationPolicy,
  organiserMeetsPublishingRequirements,
  publicEventSettings,
  validateEventPayload,
};
