const { validateAddress } = require("./addressRules");
const { isValidCoordinates } = require("./locationCoordinates");
const EventCenterSettings = require("../models/management/eventCenterSettings.schema");

const getEventCenterSettings = () => EventCenterSettings.getSingleton();


const validateVenuePayload = (
  payload,
  settings,
  { publishing = false, requireComplete = publishing, existing = false, isListed = false, changes = payload } = {},
) => {
  const errors = [];
  if (payload.location?.countryCode) {
    errors.push(...Object.values(validateAddress(payload.location, { requireComplete })));
  }
  const coords = payload.location?.coordinates;
  if (coords !== undefined && (coords.latitude !== undefined || coords.longitude !== undefined) && !isValidCoordinates(coords)) {
    errors.push("Venue coordinates must contain a latitude from -90 to 90 and a longitude from -180 to 180.");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "cancellationPolicy")) {
    const policy = changes.cancellationPolicy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) errors.push("Enter a cancellation policy.");
    else {
      if (typeof policy.allowGuestCancellation !== "boolean") errors.push("Choose whether guests can cancel.");
      if (!Number.isInteger(policy.noticeHours) || policy.noticeHours < 0 || policy.noticeHours > 8760) errors.push("Cancellation notice must be 0-8760 whole hours.");
      if (policy.rescheduleApprovalRequired !== undefined && typeof policy.rescheduleApprovalRequired !== "boolean") errors.push("Choose whether rescheduling requires organiser approval.");
      if (policy.allowGuestReschedule !== undefined && typeof policy.allowGuestReschedule !== "boolean") errors.push("Choose whether guests can request rescheduling.");
      if (policy.rescheduleNoticeHours !== undefined && (!Number.isInteger(policy.rescheduleNoticeHours) || policy.rescheduleNoticeHours < 0 || policy.rescheduleNoticeHours > 8760)) errors.push("Rescheduling notice must be 0-8760 whole hours.");
      if (policy.maxReschedules !== undefined && (!Number.isInteger(policy.maxReschedules) || policy.maxReschedules < 1 || policy.maxReschedules > 100)) errors.push("Reschedule limit must be a whole number from 1 to 100.");
      for (const field of ["noticeUnit", "rescheduleNoticeUnit"]) {
        if (policy[field] !== undefined && !["hours", "days"].includes(policy[field])) errors.push("Choose hours or days for the notice period.");
      }
      if (policy.refundMinDays !== undefined && (!Number.isInteger(policy.refundMinDays) || policy.refundMinDays < 1 || policy.refundMinDays > 90)) errors.push("Minimum refund deadline must be 1-90 whole days.");
      if (!Number.isInteger(policy.refundDays) || policy.refundDays < 1 || policy.refundDays > 90) errors.push("Refund deadline must be 1-90 whole days.");
      if (Number.isInteger(policy.refundMinDays) && Number.isInteger(policy.refundDays) && policy.refundMinDays > policy.refundDays) errors.push("Refund deadline minimum days cannot exceed maximum days.");
      if (typeof policy.refundInstructions !== "string" || policy.refundInstructions.length > 2000) errors.push("Refund instructions must be at most 2000 characters.");
    }
  }
  const shouldValidate = (field) =>
    !existing ||
    publishing ||
    Object.prototype.hasOwnProperty.call(changes, field);

  if (!existing && !settings.general.venueCreationEnabled) {
    errors.push("Venue creation is temporarily disabled");
  }


  if (shouldValidate("availability") && payload.availability) {
    const a = { ...payload.availability, operationalHours: payload.availability.operationalHours || {} };
    const clock = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || "");
    if (a.operationalHours?.open !== undefined || a.operationalHours?.close !== undefined || publishing) {
      const close = ["00:00", "24:00"].includes(a.operationalHours.close) ? "24:00" : a.operationalHours.close;
      if (!clock(a.operationalHours.open) || !(clock(a.operationalHours.close) || a.operationalHours.close === "24:00") || a.operationalHours.open >= close)
        errors.push("Opening hours require a valid start before closing (HH:mm; 24:00 means midnight).");
    }
    if (a.minDuration !== undefined && (!Number.isInteger(a.minDuration) || a.minDuration < 1)) errors.push("Minimum duration must be a positive whole number.");
    if (a.maxDuration !== undefined && (!Number.isInteger(a.maxDuration) || a.maxDuration < (a.minDuration || 1))) errors.push("Maximum duration must be at least the minimum.");
    if (a.advanceNotice?.days !== undefined && (!Number.isInteger(a.advanceNotice.days) || a.advanceNotice.days < 0 || a.advanceNotice.days > 365)) errors.push("Advance notice must be 0-365 whole days.");
    if (a.advanceNotice?.sameDayCutoffTime && !clock(a.advanceNotice.sameDayCutoffTime)) errors.push("Use HH:mm for the same-day cutoff.");
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
  if (
    (shouldValidate("bookingSettings") || shouldValidate("basePrice")) &&
    payload.bookingSettings === "REVIEW" &&
    payload.basePrice?.currency &&
    payload.basePrice.currency !== "NGN"
  ) {
    errors.push("Review bookings require NGN pricing. Change the currency or use instant booking.");
  }

  if (shouldValidate("capacity") && payload.capacity?.max !== undefined &&
      (!Number.isInteger(payload.capacity.max) || payload.capacity.max <= 0)) {
    errors.push("Capacity must be a positive whole number");
  }
  if (shouldValidate("basePrice") && payload.basePrice?.unit !== undefined && !["hour", "day"].includes(payload.basePrice.unit))
    errors.push("Choose hourly or daily pricing. Per-event pricing is not supported.");
  for (const field of ["basePrice", "weekendPrice"]) {
    const minimum = payload[field]?.minDuration;
    if (shouldValidate(field) && minimum !== undefined && (!Number.isInteger(minimum) || minimum < 1 || minimum > 24))
      errors.push("Minimum booking hours must be a whole number from 1 to 24.");
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

  const requireFieldComplete = (field) =>
    requireComplete || (isListed && Object.prototype.hasOwnProperty.call(changes, field));

  if (requireFieldComplete("location")) {
    if (!payload.location?.addressString || !isValidCoordinates(payload.location?.coordinates))
      errors.push("A mapped venue address is required before publishing.");
  }
  if (requireFieldComplete("basePrice")) {
    if (!payload.basePrice || !Number.isFinite(payload.basePrice.amount) || payload.basePrice.amount <= 0 || !["hour", "day"].includes(payload.basePrice.unit))
      errors.push("A positive hourly or daily price is required before publishing.");
  }
  for (const [field, label] of [
    ["venueName", "Venue name"], ["venueType", "Venue type"],
    ["shortDescription", "Short description"], ["description", "Description"],
  ]) {
    if (requireFieldComplete(field) && (typeof payload[field] !== "string" || !payload[field].trim())) {
      errors.push(label + " is required before publishing");
    }
  }
  if (requireFieldComplete("supportedEvents") && (!Array.isArray(payload.supportedEvents) || !payload.supportedEvents.length)) {
    errors.push("At least one supported event type is required before publishing");
  }
  if (requireFieldComplete("capacity") && (!Number.isInteger(payload.capacity?.max) || payload.capacity.max <= 0)) {
    errors.push("A valid maximum capacity is required before publishing");
  }
  if (
    requireFieldComplete("images") &&
    (!Array.isArray(payload.images) ||
      payload.images.length < settings.publishing.minimumImages)
  ) {
    errors.push(
      `At least ${settings.publishing.minimumImages} property images are required before publishing`,
    );
  }
  if (
    requireFieldComplete("safety") &&
    (!Array.isArray(payload.safety) ||
      payload.safety.length < settings.publishing.minimumSafetyItems)
  ) {
    errors.push(
      `At least ${settings.publishing.minimumSafetyItems} safety & security items are required before publishing`,
    );
  }
  if (requireFieldComplete("basePrice") && payload.basePrice?.amount !== undefined) {
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

  return errors;
};

const payoutReadinessError = (user, venue) => {
  if (venue.bookingSettings === "REVIEW") {
    if ((venue.basePrice?.currency || "NGN") !== "NGN") return "Review bookings require NGN pricing. Change the currency or use instant booking.";
    if (!user?.bankDetails?.accountNumber || !user?.bankDetails?.bankCode) return "Connect the venue owner's payout bank account before enabling review bookings.";
  } else if (!user?.vendorAccountCode) return "Connect the venue owner's online payout account before enabling instant bookings.";
  return null;
};
const ownerMeetsPublishingRequirements = (user, settings, venue) => {
  if (settings?.publishing?.requireIdentityVerification !== false && !user?.isIdentityVerified) return false;
  if (venue) return !payoutReadinessError(user, venue);
  return Boolean(user?.vendorAccountCode || (user?.bankDetails?.accountNumber && user?.bankDetails?.bankCode));
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
  payoutReadinessError,
  getEventCenterSettings,
  ownerMeetsPublishingRequirements,
  publicEventCenterSettings,
  validateVenuePayload,
};
