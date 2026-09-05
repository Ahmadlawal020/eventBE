const asyncHandler = require("express-async-handler");
const {
  getReferralStats,
  applyReferralCode,
} = require("../../services/referral.service");

// @desc    Get user referral dashboard stats, link, list of referred users & earnings
// @route   GET /api/referrals/stats
// @access  Private
const getUserReferralStats = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const data = await getReferralStats(userId);
  return res.status(200).json({
    success: true,
    data,
  });
});

// @desc    Apply a referral code to the user's account
// @route   POST /api/referrals/apply
// @access  Private
const applyUserReferralCode = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { referralCode } = req.body;

  if (!referralCode) {
    return res.status(400).json({
      success: false,
      message: "Referral code is required",
    });
  }

  try {
    const result = await applyReferralCode(userId, referralCode);
    return res.status(200).json({
      success: true,
      message: `Successfully referred by ${result.referrerName}`,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to apply referral code",
    });
  }
});

module.exports = {
  getUserReferralStats,
  applyUserReferralCode,
};
