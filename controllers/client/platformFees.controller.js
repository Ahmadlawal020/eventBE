const PlatformFees = require("../../models/management/platformFees.schema");
const { normaliseTicketFeeSettings } = require("../../services/ticketFees.service");

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
        ...normaliseTicketFeeSettings(fees),
        eventCenterCommission: fees.eventCenterCommission,
      },
    });
  } catch (error) {
    console.error("Error fetching platform fees:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getPlatformFees };
