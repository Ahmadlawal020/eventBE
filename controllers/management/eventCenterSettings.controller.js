const EventCenterSettings = require("../../models/management/eventCenterSettings.schema");
const {
  recordAdminAction,
} = require("../../services/management/adminAudit.service");
const {
  getEventCenterSettings,
  publicEventCenterSettings,
} = require("../../services/eventCenterSettings.service");

const SECTION_FIELDS = {
  general: ["venueCreationEnabled"],
  publishing: [
    "autoPublishVerifiedOwners",
    "requireIdentityVerification",
    "minimumImages",
    "minimumSafetyItems",
  ],
  contentLimits: [
    "maxVenueNameLength",
    "maxShortDescriptionLength",
    "maxDescriptionLength",
    "minImages",
    "maxImages",
    "maxCustomRules",
  ],
  booking: [
    "instantBookingEnabled",
    "reviewBookingEnabled",
    "defaultBookingMode",
    "maximumBookingWindowMonths",
    "maximumBookingDate",
  ],
  pricing: [
    "feeCollectionMode",
    "minimumBasePrice",
    "minimumBasePrices",
  ],
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
      const picked = pick(req.body[section], fields);
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

    if (
      !settings.booking.instantBookingEnabled &&
      settings.booking.defaultBookingMode === "INSTANT"
    ) {
      settings.booking.defaultBookingMode = "REVIEW";
    } else if (
      !settings.booking.reviewBookingEnabled &&
      settings.booking.defaultBookingMode === "REVIEW"
    ) {
      settings.booking.defaultBookingMode = "INSTANT";
    }
    if (req.body.contentLimits?.minImages !== undefined && req.body.publishing?.minimumImages === undefined) {
      settings.publishing.minimumImages = settings.contentLimits.minImages;
    } else if (req.body.publishing?.minimumImages !== undefined && req.body.contentLimits?.minImages === undefined) {
      settings.contentLimits.minImages = settings.publishing.minimumImages;
    }

    const effectiveMinImages = settings.contentLimits.minImages ?? settings.publishing.minimumImages ?? 0;
    if (effectiveMinImages > settings.contentLimits.maxImages) {
      return res.status(400).json({
        success: false,
        message: "Minimum property images cannot exceed maximum property images",
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
