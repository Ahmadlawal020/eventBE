const PlatformFees = require("../../models/admin/platformFees.schema");

// GET /api/platform-fees
const getPlatformFees = async (req, res) => {
  try {
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

module.exports = { getPlatformFees };
