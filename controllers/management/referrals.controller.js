const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const ReferralEarning = require("../../models/client/referralEarning.schema");
const User = require("../../models/client/user.schema");
const Event = require("../../models/client/event.schema");
const EventCenter = require("../../models/client/eventCenter.schema");
const PlatformFees = require("../../models/management/platformFees.schema");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const boundedInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

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
        totalPlatformFeeVolume: { $sum: { $ifNull: ["$platformFeeAmount", 0] } },
        totalTransactions: { $sum: 1 },
      },
    },
  ]);

  const totalCommissionsPaid = earningsAgg[0]?.totalCommissionsPaid || 0;
  const totalSalesVolume = earningsAgg[0]?.totalSalesVolume || 0;
  const totalPlatformFeeVolume = earningsAgg[0]?.totalPlatformFeeVolume || 0;
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
      totalPlatformFeeVolume,
      totalTransactions,
      topReferrers,
    },
  });
});

// @desc    Get paginated referral commission transactions for admin
// @route   GET /api/admin/referrals/earnings
// @access  Private (Admin)
const getAdminReferralEarnings = asyncHandler(async (req, res) => {
  const page = boundedInteger(req.query.page, 1, 100000);
  const limit = boundedInteger(req.query.limit, 20, 100);
  const status = String(req.query.status || "ALL");
  if (!["ALL", "PENDING", "COMPLETED", "REFUNDED"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid earnings status" });
  }
  const filter = status === "ALL" ? {} : { status };
  const skip = (page - 1) * limit;

  const [total, earnings] = await Promise.all([
    ReferralEarning.countDocuments(filter),
    ReferralEarning.find(filter)
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

// @desc    List referrers with account-level referral and earnings summaries
// @route   GET /api/admin/referrals/referrers
// @access  Private (Admin)
const getAdminReferrers = asyncHandler(async (req, res) => {
  const page = boundedInteger(req.query.page, 1, 100000);
  const limit = boundedInteger(req.query.limit, 12, 50);
  const search = String(req.query.q || "").trim().slice(0, 100);
  const searchExpression = search ? new RegExp(escapeRegex(search), "i") : null;

  const pipeline = [
    { $match: { referredBy: { $ne: null } } },
    {
      $group: {
        _id: "$referredBy",
        referralCount: { $sum: 1 },
        organiserCount: {
          $sum: { $cond: [{ $in: ["organiser", "$roles"] }, 1, 0] },
        },
        lastReferralAt: { $max: { $ifNull: ["$referredAt", "$createdAt"] } },
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
  ];
  const status = String(req.query.status || "ALL");
  if (!["ALL", "ACTIVE", "SUSPENDED"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid affiliate status" });
  }
  if (status !== "ALL") {
    pipeline.push({ $match: { "user.isActive": status === "ACTIVE" ? true : { $ne: true } } });
  }
  if (searchExpression) {
    pipeline.push({
      $match: {
        $or: [
          { "user.firstName": searchExpression },
          { "user.surname": searchExpression },
          { "user.email": searchExpression },
          { "user.referralCode": searchExpression },
        ],
      },
    });
  }
  pipeline.push(
    {
      $lookup: {
        from: ReferralEarning.collection.name,
        let: { referrerId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$referrer", "$$referrerId"] } } },
          {
            $group: {
              _id: null,
              completedEarnings: {
                $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$commissionAmount", 0] },
              },
              pendingEarnings: {
                $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, "$commissionAmount", 0] },
              },
              refundedEarnings: {
                $sum: { $cond: [{ $eq: ["$status", "REFUNDED"] }, "$commissionAmount", 0] },
              },
              rewardTransactions: { $sum: 1 },
            },
          },
        ],
        as: "earningSummary",
      },
    },
    { $set: { earningSummary: { $first: "$earningSummary" } } },
    {
      $project: {
        _id: 1,
        firstName: "$user.firstName",
        surname: "$user.surname",
        email: "$user.email",
        referralCode: "$user.referralCode",
        profilePicture: "$user.profilePicture",
        isActive: "$user.isActive",
        roles: "$user.roles",
        referralCount: 1,
        organiserCount: 1,
        lastReferralAt: 1,
        completedEarnings: { $ifNull: ["$earningSummary.completedEarnings", 0] },
        pendingEarnings: { $ifNull: ["$earningSummary.pendingEarnings", 0] },
        refundedEarnings: { $ifNull: ["$earningSummary.refundedEarnings", 0] },
        rewardTransactions: { $ifNull: ["$earningSummary.rewardTransactions", 0] },
      },
    },
    { $sort: { referralCount: -1, completedEarnings: -1, _id: 1 } },
    {
      $facet: {
        referrers: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: "value" }],
      },
    },
  );

  const [result = { referrers: [], total: [] }] = await User.aggregate(pipeline);
  const total = result.total[0]?.value || 0;
  res.json({
    success: true,
    data: {
      referrers: result.referrers,
      pagination: { total, page, pages: Math.ceil(total / limit), limit },
    },
  });
});

// @desc    Show one referrer, everyone they referred, and recorded earnings
// @route   GET /api/admin/referrals/referrers/:id
// @access  Private (Admin)
const getAdminReferrerDetails = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid referrer ID" });
  }
  const referrerId = new mongoose.Types.ObjectId(req.params.id);
  const page = boundedInteger(req.query.page, 1, 100000);
  const limit = boundedInteger(req.query.limit, 20, 50);
  const referrer = await User.findById(referrerId)
    .select("firstName surname email referralCode profilePicture roles isActive createdAt referredAt referredBy")
    .populate("referredBy", "firstName surname email referralCode")
    .lean();
  if (!referrer) return res.status(404).json({ success: false, message: "Referrer not found" });

  const filter = { referredBy: referrerId };
  const [total, referredUsers, earningSummary, recentEarnings, affiliationSummary, affiliationEarnings] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .select("firstName surname email profilePicture roles isActive referredAt createdAt")
      .sort({ referredAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ReferralEarning.aggregate([
      { $match: { referrer: referrerId } },
      {
        $group: {
          _id: "$referredUser",
          completedEarnings: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$commissionAmount", 0] } },
          pendingEarnings: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, "$commissionAmount", 0] } },
          refundedEarnings: { $sum: { $cond: [{ $eq: ["$status", "REFUNDED"] }, "$commissionAmount", 0] } },
          salesVolume: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$totalAmount", 0] } },
          platformFeeVolume: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, { $ifNull: ["$platformFeeAmount", 0] }, 0] } },
          transactions: { $sum: 1 },
        },
      },
    ]),
    ReferralEarning.find({ referrer: referrerId })
      .populate("referredUser", "firstName surname email")
      .populate("eventId", "title")
      .populate("eventCenterId", "venueName")
      .sort({ qualifiedAt: -1, createdAt: -1 })
      .limit(10)
      .lean(),
    ReferralEarning.aggregate([
      { $match: { referredUser: referrerId } },
      {
        $group: {
          _id: null,
          completedEarnings: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$commissionAmount", 0] } },
          pendingEarnings: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, "$commissionAmount", 0] } },
          refundedEarnings: { $sum: { $cond: [{ $eq: ["$status", "REFUNDED"] }, "$commissionAmount", 0] } },
          salesVolume: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$totalAmount", 0] } },
          platformFeeVolume: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, { $ifNull: ["$platformFeeAmount", 0] }, 0] } },
          transactions: { $sum: 1 },
          firstRewardAt: { $min: { $ifNull: ["$qualifiedAt", "$createdAt"] } },
          latestRewardAt: { $max: { $ifNull: ["$qualifiedAt", "$createdAt"] } },
        },
      },
    ]),
    ReferralEarning.find({ referredUser: referrerId })
      .populate("referrer", "firstName surname email referralCode")
      .populate("eventId", "title")
      .populate("eventCenterId", "venueName")
      .sort({ qualifiedAt: -1, createdAt: -1 })
      .limit(20)
      .lean(),
  ]);
  const earningsByUser = new Map(earningSummary.map((entry) => [String(entry._id), entry]));
  const referrals = referredUsers.map((user) => ({
    ...user,
    earnings: earningsByUser.get(String(user._id)) || {
      completedEarnings: 0,
      pendingEarnings: 0,
      refundedEarnings: 0,
      salesVolume: 0,
      platformFeeVolume: 0,
      transactions: 0,
    },
  }));
  const totals = earningSummary.reduce(
    (sum, entry) => ({
      completedEarnings: sum.completedEarnings + entry.completedEarnings,
      pendingEarnings: sum.pendingEarnings + entry.pendingEarnings,
      refundedEarnings: sum.refundedEarnings + entry.refundedEarnings,
      salesVolume: sum.salesVolume + entry.salesVolume,
      platformFeeVolume: sum.platformFeeVolume + entry.platformFeeVolume,
      transactions: sum.transactions + entry.transactions,
    }),
    { completedEarnings: 0, pendingEarnings: 0, refundedEarnings: 0, salesVolume: 0, platformFeeVolume: 0, transactions: 0 },
  );

  res.json({
    success: true,
    data: {
      referrer,
      affiliation: {
        referredBy: referrer.referredBy || null,
        referredAt: referrer.referredAt || null,
        totals: affiliationSummary[0] || {
          completedEarnings: 0,
          pendingEarnings: 0,
          refundedEarnings: 0,
          salesVolume: 0,
          platformFeeVolume: 0,
          transactions: 0,
          firstRewardAt: null,
          latestRewardAt: null,
        },
        earnings: affiliationEarnings,
      },
      totals: { ...totals, referralCount: total },
      referrals,
      recentEarnings,
      pagination: { total, page, pages: Math.ceil(total / limit), limit },
    },
  });
});

module.exports = {
  getAdminReferralStats,
  getAdminReferralEarnings,
  getAdminReferrers,
  getAdminReferrerDetails,
};
