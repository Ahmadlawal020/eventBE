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
    "defaultTimezone",
    "defaultCurrency",
  ],
  publishing: [
    "autoPublishVerifiedOrganisers",
    "requireIdentityVerification",
    "requirePayoutAccount",
    "requireCoverImage",
    "minimumImages",
    "minLeadTimeHours",
    "maxDurationDays",
  ],
  contentLimits: [
    "maxTitleLength",
    "maxShortDescriptionLength",
    "maxDescriptionLength",
    "minImages",
    "maxImages",
  ],
  ticketing: [
    "freeEventsEnabled",
    "paidEventsEnabled",
    "onSiteTicketsEnabled",
    "maxTicketTiers",
    "maxTicketsPerOrder",
    "salesCutoffMinutes",
  ],
  pricing: [
    "feeCollectionMode",
    "minimumBasePrice",
    "minimumBasePrices",
  ],
  lifecycle: ["autoCompletePastEvents", "completionGraceHours"],
  guidance: [
    "defaultRefundPolicy",
    "defaultArrivalNotes",
    "defaultParkingInformation",
    "defaultCheckInInstructions",
  ],
};


const serialise = (settings) => {
  const value = settings.toObject();
  delete value._id;
  delete value.__v;
  delete value.key;
  if (value.general) delete value.general.draftsEnabled;
  return value;
};

const pick = (source, fields) =>
  Object.fromEntries(
    fields
      .filter((field) => source?.[field] !== undefined)
      .map((field) => [field, source[field]]),
  );

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
      const current = previousValue[section] || {};
      const picked = pick(req.body[section], fields);
      if (!Object.keys(picked).length) continue;
      if (section === "pricing" && req.body.pricing?.minimumBasePrices) {
        picked.minimumBasePrices = {
          ...(current.minimumBasePrices || {}),
          ...req.body.pricing.minimumBasePrices,
        };
      }
      settings.set(section, { ...current, ...picked });
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({
        success: false,
        message: "No valid event settings were provided",
      });
    }

    if (req.body.contentLimits?.minImages !== undefined && req.body.publishing?.minimumImages === undefined) {
      settings.publishing.minimumImages = settings.contentLimits.minImages;
    } else if (req.body.publishing?.minimumImages !== undefined && req.body.contentLimits?.minImages === undefined) {
      settings.contentLimits.minImages = settings.publishing.minimumImages;
    }

    try { new Intl.DateTimeFormat("en", { timeZone: settings.general.defaultTimezone }).format(); }
    catch { return res.status(400).json({ message: "Choose a valid IANA timezone." }); }
    if (!["NGN", "USD", "EUR", "GBP", "AED", "SAR", "GHS", "KES", "ZAR"].includes(settings.general.defaultCurrency)) return res.status(400).json({ message: "Choose a supported default currency." });
    const effectiveMinImages = Math.max(settings.contentLimits.minImages ?? 0, settings.publishing.minimumImages ?? 0, settings.publishing.requireCoverImage ? 1 : 0);
    if (effectiveMinImages > settings.contentLimits.maxImages) {
      return res.status(400).json({
        success: false,
        message: "Minimum event images cannot exceed maximum event images",
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
    const settings = await require("../../services/eventSettings.service").getEffectiveEventSettings();
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
