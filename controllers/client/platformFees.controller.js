const PlatformFees = require("../../models/management/platformFees.schema");

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
        referralCommission: fees.referralCommission ?? 5,
        referralDurationDays: fees.referralDurationDays ?? 90,
        referralProgramEnabled: fees.referralProgramEnabled !== false,
      },
    });
  } catch (error) {
    console.error("Error fetching platform fees:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getPlatformFees };
