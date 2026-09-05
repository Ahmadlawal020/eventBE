const EventSettings = require("../../models/management/eventSettings.schema");
const {
  recordAdminAction,
} = require("../../services/management/adminAudit.service");
const {
  getEventSettings,
  publicEventSettings,
} = require("../../services/eventSettings.service");

const SECTION_FIELDS = {
  general: [
    "eventCreationEnabled",
    "draftsEnabled",
    "defaultTimezone",
    "defaultCurrency",
  ],
  publishing: [
    "autoPublishVerifiedOrganisers",
    "requireIdentityVerification",
    "requirePhoneVerification",
    "requireCoverImage",
    "requireSpecificLocation",
    "minLeadTimeHours",
    "maxDurationDays",
  ],
  contentLimits: [
    "maxTitleLength",
    "maxShortDescriptionLength",
    "maxDescriptionLength",
    "maxImages",
    "maxHighlights",
    "maxPerformers",
  ],
  ticketing: [
    "freeEventsEnabled",
    "paidEventsEnabled",
    "onSiteTicketsEnabled",
    "requireRefundPolicyForPaidEvents",
    "maxTicketTiers",
    "maxTicketsPerOrder",
    "salesCutoffMinutes",
  ],
  lifecycle: ["autoCompletePastEvents", "completionGraceHours"],
  guidance: [
    "defaultRefundPolicy",
    "defaultArrivalNotes",
    "defaultParkingInformation",
    "defaultCheckInInstructions",
  ],
};

const CATALOGS = {
  categories: EventSettings.EVENT_CATEGORIES,
  amenities: EventSettings.EVENT_AMENITIES,
  safetyOptions: EventSettings.EVENT_SAFETY_OPTIONS,
  safetyConsiderations: EventSettings.EVENT_SAFETY_CONSIDERATIONS,
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

const getAdminEventSettings = async (_req, res) => {
  try {
    const settings = await getEventSettings();
    return res.json({ success: true, data: serialise(settings) });
  } catch (error) {
    console.error("[ADMIN GET EVENT SETTINGS]", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching event settings",
    });
  }
};

const updateAdminEventSettings = async (req, res) => {
  try {
    const settings = await getEventSettings();
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
        message: "No valid event settings were provided",
      });
    }

    await settings.save();
    const newValue = serialise(settings);

    await recordAdminAction({
      req,
      action: "EVENT_SETTINGS_UPDATED",
      targetType: "System",
      targetId: settings._id,
      previousValue,
      newValue,
    });

    return res.json({
      success: true,
      message: "Event settings updated",
      data: newValue,
    });
  } catch (error) {
    console.error("[ADMIN UPDATE EVENT SETTINGS]", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors)[0]?.message || "Invalid settings",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Server error updating event settings",
    });
  }
};

const getPublicEventSettings = async (_req, res) => {
  try {
    const settings = await getEventSettings();
    return res.json({ success: true, data: publicEventSettings(settings) });
  } catch (error) {
    console.error("[GET EVENT SETTINGS]", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching event configuration",
    });
  }
};

module.exports = {
  getAdminEventSettings,
  getPublicEventSettings,
  updateAdminEventSettings,
};
