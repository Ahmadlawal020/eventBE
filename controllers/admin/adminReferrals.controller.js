const asyncHandler = require("express-async-handler");
const ReferralEarning = require("../../models/user/referralEarning.schema");
const User = require("../../models/user/user.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const PlatformFees = require("../../models/admin/platformFees.schema");

// @desc    Get overall admin referral statistics
// @route   GET /api/admin/referrals/stats
// @access  Private (Admin)
const getAdminReferralStats = asyncHandler(async (req, res) => {
  const [totalReferralsCount, totalOrganisersReferred] = await Promise.all([
    User.countDocuments({ referredBy: { $ne: null } }),
    User.countDocuments({ referredBy: { $ne: null }, roles: "organiser" }),
  ]);

  const earningsAgg = await ReferralEarning.aggregate([
    { $match: { status: "COMPLETED" } },
    {
      $group: {
        _id: null,
        totalCommissionsPaid: { $sum: "$commissionAmount" },
        totalSalesVolume: { $sum: "$totalAmount" },
        totalTransactions: { $sum: 1 },
      },
    },
  ]);

  const totalCommissionsPaid = earningsAgg[0]?.totalCommissionsPaid || 0;
  const totalSalesVolume = earningsAgg[0]?.totalSalesVolume || 0;
  const totalTransactions = earningsAgg[0]?.totalTransactions || 0;

  // Top Referrers
  const topReferrers = await ReferralEarning.aggregate([
    { $match: { status: "COMPLETED" } },
    {
      $group: {
        _id: "$referrer",
        totalEarned: { $sum: "$commissionAmount" },
        commissionsCount: { $sum: 1 },
      },
    },
    { $sort: { totalEarned: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "referrerDetails",
      },
    },
    { $unwind: "$referrerDetails" },
    {
      $project: {
        _id: 1,
        totalEarned: 1,
        commissionsCount: 1,
        name: { $concat: ["$referrerDetails.firstName", " ", "$referrerDetails.surname"] },
        email: "$referrerDetails.email",
        referralCode: "$referrerDetails.referralCode",
      },
    },
  ]);

  return res.status(200).json({
    success: true,
    data: {
      totalReferralsCount,
      totalOrganisersReferred,
      totalCommissionsPaid,
      totalSalesVolume,
      totalTransactions,
      topReferrers,
    },
  });
});

// @desc    Get paginated referral commission transactions for admin
// @route   GET /api/admin/referrals/earnings
// @access  Private (Admin)
const getAdminReferralEarnings = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const [total, earnings] = await Promise.all([
    ReferralEarning.countDocuments(),
    ReferralEarning.find()
      .populate("referrer", "firstName surname email referralCode")
      .populate("referredUser", "firstName surname email roles")
      .populate("eventId", "title")
      .populate("eventCenterId", "venueName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      earnings,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    },
  });
});

module.exports = {
  getAdminReferralStats,
  getAdminReferralEarnings,
};
