const asyncHandler = require("express-async-handler");
const IdentityVerification = require("../../models/user/identityVerification.schema");
const User = require("../../models/user/user.schema");
const cloudinary = require("../../utils/cloudinary");

/**
 * Helper: destroy a Cloudinary image safely (fire-and-forget style)
 */
const destroyCloudinaryImage = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error("[KYC CLOUDINARY DELETE ERROR]", publicId, err);
  }
};

// @desc    Submit identity verification (KYC)
// @route   POST /api/kyc/submit
// @access  Private
const submitKyc = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { idType, idFrontImage, idBackImage, selfieImage } = req.body;

  // ── Validation ──
  if (!idType || !idFrontImage?.url || !selfieImage?.url) {
    return res.status(400).json({
      message:
        "idType, idFrontImage (url + publicId), and selfieImage (url + publicId) are required.",
    });
  }

  // For non-passport types, back image is required
  if (idType !== "PP" && !idBackImage?.url) {
    return res.status(400).json({
      message: "Back of ID image is required for this document type.",
    });
  }

  // Check if there is an active (pending or approved) verification request
  const existing = await IdentityVerification.findOne({ userId }).sort({
    createdAt: -1,
  });

  if (existing && (existing.status === "pending" || existing.status === "approved")) {
    return res.status(400).json({
      message: "You already have an active identity verification request.",
    });
  }

  // If there's an existing rejected one, clean up the files first
  if (existing) {
    await Promise.all([
      destroyCloudinaryImage(existing.idFrontImage?.publicId),
      destroyCloudinaryImage(existing.idBackImage?.publicId),
      destroyCloudinaryImage(existing.selfieImage?.publicId),
    ]);

    // Remove the old record
    await IdentityVerification.deleteOne({ _id: existing._id });
  }

  // ── Create new verification record ──
  const verification = await IdentityVerification.create({
    userId,
    idType,
    idFrontImage: {
      url: idFrontImage.url,
      publicId: idFrontImage.publicId,
    },
    idBackImage: idBackImage
      ? {
          url: idBackImage.url,
          publicId: idBackImage.publicId,
        }
      : null,
    selfieImage: {
      url: selfieImage.url,
      publicId: selfieImage.publicId,
    },
    status: "pending",
  });

  // ── Update user: mark identity as NOT yet verified (pending review) ──
  await User.findByIdAndUpdate(userId, { isIdentityVerified: false });

  res.status(201).json({
    message: "Identity verification submitted successfully.",
    verification: {
      id: verification._id,
      status: verification.status,
      idType: verification.idType,
      createdAt: verification.createdAt,
    },
  });
});

// @desc    Get KYC verification status
// @route   GET /api/kyc/status
// @access  Private
const getKycStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const verification = await IdentityVerification.findOne({ userId })
    .sort({ createdAt: -1 })
    .lean();

  if (!verification) {
    return res.json({
      hasSubmitted: false,
      status: null,
      verification: null,
    });
  }

  res.json({
    hasSubmitted: true,
    status: verification.status,
    verification: {
      id: verification._id,
      idType: verification.idType,
      status: verification.status,
      rejectionReason: verification.rejectionReason,
      idFrontImage: verification.idFrontImage ? { url: verification.idFrontImage.url } : null,
      idBackImage: verification.idBackImage ? { url: verification.idBackImage.url } : null,
      selfieImage: verification.selfieImage ? { url: verification.selfieImage.url } : null,
      createdAt: verification.createdAt,
      reviewedAt: verification.reviewedAt,
    },
  });
});

// @desc    Cancel active KYC request
// @route   DELETE /api/kyc/cancel
// @access  Private
const cancelKyc = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const verification = await IdentityVerification.findOne({ userId }).sort({
    createdAt: -1,
  });

  if (!verification) {
    return res.status(404).json({
      message: "No active identity verification request found.",
    });
  }

  if (verification.status !== "pending") {
    return res.status(400).json({
      message: `Cannot cancel a verification request that is already ${verification.status}.`,
    });
  }

  // Cleanup files from Cloudinary
  await Promise.all([
    destroyCloudinaryImage(verification.idFrontImage?.publicId),
    destroyCloudinaryImage(verification.idBackImage?.publicId),
    destroyCloudinaryImage(verification.selfieImage?.publicId),
  ]);

  // Delete database record
  await IdentityVerification.deleteOne({ _id: verification._id });

  // Update user verified flag to false
  await User.findByIdAndUpdate(userId, { isIdentityVerified: false });

  res.json({
    message: "Identity verification request cancelled successfully.",
  });
});

module.exports = {
  submitKyc,
  getKycStatus,
  cancelKyc,
};
