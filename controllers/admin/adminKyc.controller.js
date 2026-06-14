const asyncHandler = require("express-async-handler");
const IdentityVerification = require("../../models/user/identityVerification.schema");
const User = require("../../models/user/user.schema");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

// Helper: Escape search string for regex matching
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// @desc    Get all KYC requests
// @route   GET /api/admin/kyc
// @access  Private (Admin Only)
const getKycSubmissions = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 20 } = req.query;
  const query = {};

  // Apply status filter
  if (status && status !== "all") {
    // Frontend sends VERIFIED/REJECTED/PENDING, DB stores approved/rejected/pending
    const statusMap = { VERIFIED: "approved", REJECTED: "rejected", PENDING: "pending", UNDER_REVIEW: "pending" };
    query.status = statusMap[status.toUpperCase()] || status.toLowerCase();
  }

  const skip = (Number(page) - 1) * Number(limit);

  if (search) {
    const safeSearch = escapeRegex(search);
    // Find matching users first
    const users = await User.find({
      $or: [
        { firstName: new RegExp(safeSearch, "i") },
        { surname: new RegExp(safeSearch, "i") },
        { email: new RegExp(safeSearch, "i") },
      ],
    }).select("_id");

    const userIds = users.map((u) => u._id);
    query.userId = { $in: userIds };
  }

  const [verifications, total, pendingCount, approvedCount, rejectedCount] = await Promise.all([
    IdentityVerification.find(query)
      .populate("userId", "firstName surname email roles phone phoneNumber createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    IdentityVerification.countDocuments(query),
    IdentityVerification.countDocuments({ status: "pending" }),
    IdentityVerification.countDocuments({ status: "approved" }),
    IdentityVerification.countDocuments({ status: "rejected" }),
  ]);

  const allCount = await IdentityVerification.countDocuments();

  res.json({
    success: true,
    data: {
      submissions: verifications.map((v) => ({
        _id: v._id,
        user: v.userId,
        idType: v.idType,
        status: v.status === "approved" ? "VERIFIED" : v.status.toUpperCase(), // Normalize for admin frontend
        rejectionReason: v.rejectionReason,
        createdAt: v.createdAt,
      })),
      stats: {
        total: allCount,
        pending: pendingCount,
        verified: approvedCount,
        rejected: rejectedCount,
      },
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)) || 1,
      },
    },
  });
});

// @desc    Get KYC request details
// @route   GET /api/admin/kyc/:id
// @access  Private (Admin Only)
const getKycDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const verification = await IdentityVerification.findById(id)
    .populate("userId", "firstName surname email roles phone phoneNumber createdAt")
    .lean();

  if (!verification) {
    return res.status(404).json({
      success: false,
      message: "KYC request not found.",
    });
  }

  res.json({
    success: true,
    data: {
      _id: verification._id,
      user: verification.userId,
      idType: verification.idType,
      idFrontImage: verification.idFrontImage,
      idBackImage: verification.idBackImage,
      selfieImage: verification.selfieImage,
      status: verification.status === "approved" ? "VERIFIED" : verification.status.toUpperCase(),
      rejectionReason: verification.rejectionReason,
      createdAt: verification.createdAt,
      reviewedAt: verification.reviewedAt,
    },
  });
});

// @desc    Review (Approve/Reject) KYC request
// @route   PUT /api/admin/kyc/:id/review
// @access  Private (Admin Only)
const reviewKyc = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body;

  if (!status || !["VERIFIED", "REJECTED"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Valid status (VERIFIED or REJECTED) is required.",
    });
  }

  const verification = await IdentityVerification.findById(id);
  if (!verification) {
    return res.status(404).json({
      success: false,
      message: "KYC request not found.",
    });
  }

  const isApproved = status === "VERIFIED";
  const prevStatus = verification.status;

  verification.status = isApproved ? "approved" : "rejected";
  verification.rejectionReason = isApproved ? null : (rejectionReason || "Documents are blurry or unreadable.");
  verification.reviewedAt = new Date();
  verification.reviewedBy = req.user.id;

  await verification.save();

  // Update User state
  await User.findByIdAndUpdate(verification.userId, {
    isIdentityVerified: isApproved,
  });

  // Record audit log
  await recordAdminAction({
    req,
    action: isApproved ? "USER_KYC_APPROVED" : "USER_KYC_REJECTED",
    targetType: "User",
    targetId: verification.userId,
    previousValue: { kycStatus: prevStatus.toUpperCase() },
    newValue: { kycStatus: status },
    metadata: { reason: rejectionReason, verificationId: verification._id },
  });

  res.json({
    success: true,
    message: `KYC request successfully ${status.toLowerCase()}d.`,
  });
});

module.exports = {
  getKycSubmissions,
  getKycDetails,
  reviewKyc,
};
