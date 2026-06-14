const PlatformSettings = require("../../models/admin/platformSettings.schema");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

// GET /api/admin/settings
const getSettings = async (req, res) => {
  try {
    const settings = await PlatformSettings.findOneAndUpdate(
      { key: "platform_settings" },
      { $setOnInsert: { key: "platform_settings" } },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      data: {
        platformName: settings.platformName,
        supportEmail: settings.supportEmail,
        supportPhone: settings.supportPhone,
        maintenanceMode: settings.maintenanceMode,
        registrationEnabled: settings.registrationEnabled,
        defaultCurrency: settings.defaultCurrency,
        maxUploadSizeMB: settings.maxUploadSizeMB,
        sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        requireEmailVerification: settings.requireEmailVerification,
        allowGoogleAuth: settings.allowGoogleAuth,
      },
    });
  } catch (error) {
    console.error("Error fetching platform settings:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PUT /api/admin/settings
const updateSettings = async (req, res) => {
  try {
    const allowedFields = [
      "platformName",
      "supportEmail",
      "supportPhone",
      "maintenanceMode",
      "registrationEnabled",
      "defaultCurrency",
      "maxUploadSizeMB",
      "sessionTimeoutMinutes",
      "requireEmailVerification",
      "allowGoogleAuth",
    ];

    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        update[field] = req.body[field];
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    const previousSettings = await PlatformSettings.findOne({ key: "platform_settings" });
    const previousValue = previousSettings ? { ...previousSettings.toObject() } : null;
    delete previousValue?._id;
    delete previousValue?.key;
    delete previousValue?.__v;
    delete previousValue?.createdAt;
    delete previousValue?.updatedAt;

    const settings = await PlatformSettings.findOneAndUpdate(
      { key: "platform_settings" },
      { $set: update },
      { upsert: true, new: true }
    );

    await recordAdminAction({
      req,
      action: "PLATFORM_SETTINGS_UPDATED",
      targetType: "System",
      targetId: settings._id,
      previousValue,
      newValue: update,
    });

    return res.json({
      success: true,
      data: {
        platformName: settings.platformName,
        supportEmail: settings.supportEmail,
        supportPhone: settings.supportPhone,
        maintenanceMode: settings.maintenanceMode,
        registrationEnabled: settings.registrationEnabled,
        defaultCurrency: settings.defaultCurrency,
        maxUploadSizeMB: settings.maxUploadSizeMB,
        sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
        requireEmailVerification: settings.requireEmailVerification,
        allowGoogleAuth: settings.allowGoogleAuth,
      },
    });
  } catch (error) {
    console.error("Error updating platform settings:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getSettings, updateSettings };
