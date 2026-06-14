const PlatformFees = require("../../models/admin/platformFees.schema");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

// GET /api/admin/platform-fees
const getPlatformFees = async (req, res) => {
  try {
    // Upsert ensures the singleton document always exists
    const fees = await PlatformFees.findOneAndUpdate(
      { key: "platform_fees" },
      { $setOnInsert: { key: "platform_fees" } },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      data: {
        eventCommission: fees.eventCommission,
        eventCenterCommission: fees.eventCenterCommission,
      },
    });
  } catch (error) {
    console.error("Error fetching platform fees:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PUT /api/admin/platform-fees
const updatePlatformFees = async (req, res) => {
  try {
    const { eventCommission, eventCenterCommission } = req.body;

    const update = {};
    if (eventCommission !== undefined) {
      if (eventCommission < 0 || eventCommission > 100) {
        return res.status(400).json({
          success: false,
          message: "eventCommission must be between 0 and 100",
        });
      }
      update.eventCommission = eventCommission;
    }
    if (eventCenterCommission !== undefined) {
      if (eventCenterCommission < 0 || eventCenterCommission > 100) {
        return res.status(400).json({
          success: false,
          message: "eventCenterCommission must be between 0 and 100",
        });
      }
      update.eventCenterCommission = eventCenterCommission;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }

    const fees = await PlatformFees.findOneAndUpdate(
      { key: "platform_fees" },
      { $set: update },
      { upsert: true, new: true }
    );

    await recordAdminAction({
      req,
      action: "PLATFORM_FEES_UPDATED",
      targetType: "System",
      targetId: fees._id,
      previousValue: { eventCommission: fees.eventCommission, eventCenterCommission: fees.eventCenterCommission },
      newValue: update,
    });

    return res.json({
      success: true,
      data: {
        eventCommission: fees.eventCommission,
        eventCenterCommission: fees.eventCenterCommission,
      },
    });
  } catch (error) {
    console.error("Error updating platform fees:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getPlatformFees, updatePlatformFees };
