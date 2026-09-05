const EventCenterSettings = require("../../models/management/eventCenterSettings.schema");
const {
  recordAdminAction,
} = require("../../services/management/adminAudit.service");
const {
  getEventCenterSettings,
  publicEventCenterSettings,
} = require("../../services/eventCenterSettings.service");

const SECTION_FIELDS = {
  general: ["venueCreationEnabled", "draftsEnabled", "defaultCurrency"],
  publishing: [
    "autoPublishVerifiedOwners",
    "requireIdentityVerification",
    "requirePhoneVerification",
    "requireSpecificLocation",
    "minimumImages",
    "minimumSafetyItems",
  ],
  contentLimits: [
    "maxVenueNameLength",
    "maxShortDescriptionLength",
    "maxDescriptionLength",
    "maxImages",
    "maxCustomRules",
  ],
  booking: [
    "instantBookingEnabled",
    "reviewBookingEnabled",
    "defaultBookingMode",
    "maximumBookingWindowMonths",
    "maximumAdvanceNoticeDays",
    "maximumPreparationDays",
  ],
  pricing: [
    "requireBasePrice",
    "weekendPricingEnabled",
    "customPricingEnabled",
    "discountsEnabled",
    "minimumBasePrice",
  ],
};

const CATALOGS = {
  venueTypes: EventCenterSettings.VENUE_TYPES,
  amenities: EventCenterSettings.AMENITIES,
  venueRules: EventCenterSettings.VENUE_RULES,
  safetyOptions: EventCenterSettings.SAFETY_OPTIONS,
  safetyConsiderations: EventCenterSettings.SAFETY_CONSIDERATIONS,
  discounts: EventCenterSettings.DISCOUNTS,
};

const serialise = (settings) => {
  const value = settings.toObject();
  delete value._id;
  delete value.__v;
  delete value.key;
  return value;
};

const pick = (source, fields) =>
  Object.fromEntries(
    fields
      .filter((field) => source?.[field] !== undefined)
      .map((field) => [field, source[field]]),
  );

const mergeCatalog = (current, incoming, allowedOptions) => {
  const incomingByKey = new Map(
    (Array.isArray(incoming) ? incoming : []).map((option) => [
      option.key,
      option,
    ]),
  );
  const currentByKey = new Map(
    (current || []).map((option) => [
      option.key,
      option.toObject?.() || option,
    ]),
  );
  return allowedOptions.map(([key, defaultLabel], index) => {
    const previous = currentByKey.get(key) || {};
    const update = incomingByKey.get(key) || {};
    return {
      key,
      label:
        typeof update.label === "string" && update.label.trim()
          ? update.label.trim()
          : previous.label || defaultLabel,
      enabled:
        typeof update.enabled === "boolean"
          ? update.enabled
          : (previous.enabled ?? true),
      featured:
        typeof update.featured === "boolean"
          ? update.featured
          : (previous.featured ?? false),
      sortOrder: Number.isFinite(Number(update.sortOrder))
        ? Number(update.sortOrder)
        : (previous.sortOrder ?? index),
    };
  });
};

const getAdminEventCenterSettings = async (_req, res) => {
  try {
    const settings = await getEventCenterSettings();
    return res.json({ success: true, data: serialise(settings) });
  } catch (error) {
    console.error("[ADMIN GET EVENT CENTER SETTINGS]", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching event center settings",
    });
  }
};

const updateAdminEventCenterSettings = async (req, res) => {
  try {
    const settings = await getEventCenterSettings();
    const previousValue = serialise(settings);
    let changed = false;

    for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
      if (!req.body[section]) continue;
      const current =
        settings[section]?.toObject?.() || settings[section] || {};
      settings.set(section, { ...current, ...pick(req.body[section], fields) });
      changed = true;
    }
    for (const [catalog, allowedOptions] of Object.entries(CATALOGS)) {
      if (!req.body[catalog]) continue;
      settings.set(
        catalog,
        mergeCatalog(settings[catalog], req.body[catalog], allowedOptions),
      );
      changed = true;
    }
    if (!changed) {
      return res.status(400).json({
        success: false,
        message: "No valid event center settings were provided",
      });
    }

    if (
      !settings.booking.instantBookingEnabled &&
      !settings.booking.reviewBookingEnabled
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one venue booking mode must remain enabled",
      });
    }
    if (settings.publishing.minimumImages > settings.contentLimits.maxImages) {
      return res.status(400).json({
        success: false,
        message: "Minimum required images cannot exceed the image limit",
      });
    }

    await settings.save();
    const newValue = serialise(settings);
    await recordAdminAction({
      req,
      action: "EVENT_CENTER_SETTINGS_UPDATED",
      targetType: "System",
      targetId: settings._id,
      previousValue,
      newValue,
    });
    return res.json({
      success: true,
      message: "Event center settings updated",
      data: newValue,
    });
  } catch (error) {
    console.error("[ADMIN UPDATE EVENT CENTER SETTINGS]", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors)[0]?.message || "Invalid settings",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Server error updating event center settings",
    });
  }
};

const getPublicEventCenterSettings = async (_req, res) => {
  try {
    const settings = await getEventCenterSettings();
    return res.json({
      success: true,
      data: publicEventCenterSettings(settings),
    });
  } catch (error) {
    console.error("[GET EVENT CENTER SETTINGS]", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching event center configuration",
    });
  }
};

module.exports = {
  getAdminEventCenterSettings,
  getPublicEventCenterSettings,
  updateAdminEventCenterSettings,
};
