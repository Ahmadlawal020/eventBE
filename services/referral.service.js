const mongoose = require("mongoose");
const User = require("../models/client/user.schema");
const ReferralEarning = require("../models/client/referralEarning.schema");
const Event = require("../models/client/event.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const EventBooking = require("../models/client/eventBooking.schema");
const EventCenterBooking = require("../models/client/eventCenterBooking.schema");
const PlatformFees = require("../models/management/platformFees.schema");
const { codeForUser } = require("../utils/referralCode");
const { getEffectivePolicy, getEntryEligibility } = require("./referralPolicy.service");
const { addPeriod } = require("../utils/referralPolicy");
const { dispatchNotification } = require("./notification");
const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const calculateAffiliateReward = (platformFeeAmount, percentage) =>
  Math.round(Number(platformFeeAmount || 0) * Number(percentage || 0)) / 100;

const ensureUserReferralCode = async (userDocOrId) => {
  const id = userDocOrId?._id || userDocOrId;
  const assigned = await User.findOneAndUpdate(
    { _id: id, $or: [{ referralCode: { $exists: false } }, { referralCode: null }, { referralCode: "" }] },
    { $set: { referralCode: codeForUser(id) } }, { new: true }
  ).select("referralCode").lean();
  const user = assigned || await User.findById(id).select("referralCode").lean();
  return user?.referralCode || null;
};

// Only persisted bookings determine ownership, payment, currency and sale value.
// The earnings ledger is the source of balances; a separate counter could drift.
const processReferralCommission = async ({ sourceType, bookingId, notify = true }) => {
  const isTicket = sourceType === "EVENT_TICKET";
  if (!isTicket && sourceType !== "EVENT_CENTER_BOOKING") throw new Error("Invalid referral source");
  const Booking = isTicket ? EventBooking : EventCenterBooking;
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) return null;
  const existing = await ReferralEarning.findOne({ bookingId, sourceType });
  if (booking.paymentStatus === "REFUNDED" || booking.paymentStatus === "FAILED_REFUND" || booking.status === "CANCELLED") {
    if (existing && existing.status !== "REFUNDED") {
      await ReferralEarning.updateOne({ _id: existing._id }, { $set: { status: "REFUNDED", notes: "Source booking cancelled or refunded" } });
      existing.status = "REFUNDED";
    }
    return existing;
  }
  const isPending = booking.paymentStatus !== "COMPLETED" || (!isTicket &&
    (booking.status === "PENDING_REVIEW" ||
      (booking.bookingMode === "REVIEW" && !["CONFIRMED", "COMPLETED"].includes(booking.status))));
  if (isPending) {
    if (existing?.status === "COMPLETED") {
      await ReferralEarning.updateOne({ _id: existing._id, status: "COMPLETED" }, { $set: { status: "PENDING" } });
      existing.status = "PENDING";
    }
    return existing || null;
  }
  if (existing && existing.status !== "PENDING") return existing;
  const listing = isTicket
    ? await Event.findById(booking.eventId).select("createdBy").lean()
    : await EventCenter.findById(booking.eventCenter).select("createdBy").lean();
  const organiserId = listing?.createdBy;
  if (!organiserId) return null;
  const organiser = await User.findById(organiserId).select("firstName surname referredBy referredAt createdAt").lean();
  if (!organiser?.referredBy || String(organiser.referredBy) === String(organiserId)) return null;
  const referrer = await User.findById(organiser.referredBy).select("isActive").lean();
  if (!referrer || referrer.isActive === false) return null;
  const totalAmount = isTicket
    ? Number(booking.subtotalAmount ?? booking.totalAmount) / 100
    : Number(booking.subtotalPrice?.amount ?? booking.totalPrice?.amount);
  let platformFeeAmount = isTicket
    ? Number(booking.platformFeeAmount) / 100
    : Number(booking.platformFeeAmount);
  if (!Number.isFinite(platformFeeAmount)) {
    const fees = await PlatformFees.findOne({ key: "platform_fees" }).lean();
    const rate = Number(
      isTicket ? fees?.eventCommission ?? 15 : fees?.eventCenterCommission ?? 15,
    );
    platformFeeAmount = Math.round(totalAmount * rate) / 100;
  }
  const currency = isTicket ? booking.currency : booking.totalPrice?.currency;
  const bookingReference = booking.paymentReference || booking.paystackReference;
  if (!bookingReference || (currency && currency !== "NGN") || !Number.isFinite(totalAmount) || totalAmount <= 0 || !Number.isFinite(platformFeeAmount) || platformFeeAmount <= 0) return null;
  const qualifiedAt = new Date(booking.referralQualifiedAt || booking.reviewedAt || booking.createdAt);
  const settings = await getEffectivePolicy(referrer._id, qualifiedAt);
  const percent = settings.commissionPercentage;
  if (settings.status !== "ACTIVE" || !Number.isFinite(percent) || percent <= 0) return null;
  const referredAt = new Date(organiser.referredAt || organiser.createdAt);
  // Linking a code cannot claim a sale that was already created before attribution.
  if (new Date(booking.createdAt) < referredAt) return null;
  const start = settings.startedAt && new Date(settings.startedAt) > referredAt ? new Date(settings.startedAt) : referredAt;
  const expiresAt = addPeriod(start, settings.duration);
  if (qualifiedAt < start || (expiresAt && qualifiedAt > expiresAt)) return null;
  const commissionAmount = calculateAffiliateReward(platformFeeAmount, percent);
  if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) return null;
  let earning;
  try {
    const values = {
      referrer: referrer._id, referredUser: organiserId, sourceType, bookingId,
      bookingReference, totalAmount, platformFeeAmount,
      commissionPercentage: percent, commissionAmount,
      eventId: isTicket ? booking.eventId : null,
      eventCenterId: isTicket ? null : booking.eventCenter,
      currency: "NGN", status: "COMPLETED", qualifiedAt, policyVersions: settings.policyVersions,
    };
    earning = existing
      ? await ReferralEarning.findOneAndUpdate({ _id: existing._id, status: "PENDING" }, { $set: values }, { new: true })
      : await ReferralEarning.create(values);
    if (!earning) return ReferralEarning.findById(existing._id);
  } catch (error) {
    if (error.code !== 11000) throw error;
    return ReferralEarning.findOne({ bookingReference, referrer: referrer._id, sourceType });
  }
  if (!notify) return earning;
  try {
    await dispatchNotification({
      recipient: referrer._id, sender: organiserId, type: NOTIFICATION_TYPES.REFERRAL_REWARD,
      title: "Referral reward earned",
      message: "You earned NGN " + commissionAmount.toLocaleString() + " from Munasaba's fee on a referred host's " + (isTicket ? "ticket sale." : "venue booking."),
      referenceId: earning._id, referenceType: "ReferralEarning",
      data: { screen: "Referral", earningId: String(earning._id), amount: String(commissionAmount) },
    });
  } catch (error) {
    console.error("[REFERRAL] Reward saved; notification failed:", error.message);
  }
  return earning;
};

// Fulfillment can succeed during a ledger outage. The recovery job retries missed records.
const recordBookingReferral = async (bookingId, sourceType) => {
  try {
    return await processReferralCommission({ bookingId, sourceType });
  } catch (error) {
    console.error("[REFERRAL] Recording failed; reconciliation will retry:", String(bookingId), error.message);
    return null;
  }
};

/**
 * Get comprehensive referral statistics, history, and program settings for a user
 */
const getReferralStats = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const referralCode = await ensureUserReferralCode(user);

  // 0. Fetch referrer info if user was referred by someone
  let referredByInfo = null;
  if (user.referredBy) {
    const referrerUser = await User.findById(user.referredBy)
      .select("firstName surname referralCode")
      .lean();
    if (referrerUser) {
      referredByInfo = {
        id: String(referrerUser._id),
        name: `${referrerUser.firstName || ""} ${referrerUser.surname || ""}`.trim(),
        code: referrerUser.referralCode || null,
        referredAt: user.referredAt || null,
      };
    }
  }

  const policy = await getEffectivePolicy(userId);
  const entryEligibility = await getEntryEligibility(user);
  const commissionPercent = policy.commissionPercentage;
  const durationDays = policy.duration.unit === "DAYS" ? policy.duration.value : policy.duration.unit === "WEEKS" ? policy.duration.value * 7 : null;
  const programEnabled = policy.status === "ACTIVE";

  // 1. Total referred users & organisers
  const referredUsers = await User.find({ referredBy: userId })
    .select("firstName surname email profilePicture roles createdAt referredAt")
    .sort({ createdAt: -1 })
    .lean();

  const totalReferrals = referredUsers.length;
  const organiserReferrals = referredUsers.filter((u) => u.roles?.includes("organiser")).length;

  // 2. Aggregate total earnings and category breakdown from ReferralEarning collection
  const earningsAgg = await ReferralEarning.aggregate([
    { $match: { referrer: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalEarned: {
          $sum: {
            $cond: [{ $eq: ["$status", "COMPLETED"] }, "$commissionAmount", 0],
          },
        },
        ticketEarnings: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$status", "COMPLETED"] }, { $eq: ["$sourceType", "EVENT_TICKET"] }] },
              "$commissionAmount",
              0,
            ],
          },
        },
        venueEarnings: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$status", "COMPLETED"] }, { $eq: ["$sourceType", "EVENT_CENTER_BOOKING"] }] },
              "$commissionAmount",
              0,
            ],
          },
        },
        pendingEarnings: {
          $sum: {
            $cond: [{ $eq: ["$status", "PENDING"] }, "$commissionAmount", 0],
          },
        },
        totalTransactions: {
          $sum: {
            $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0],
          },
        },
      },
    },
  ]);

  const totalEarned = earningsAgg[0]?.totalEarned ?? 0;
  const ticketEarnings = earningsAgg[0]?.ticketEarnings ?? 0;
  const venueEarnings = earningsAgg[0]?.venueEarnings ?? 0;
  const pendingEarnings = earningsAgg[0]?.pendingEarnings ?? 0;
  const paidOut = 0; // Payout disbursement tracking
  const availableBalance = Math.max(0, totalEarned - paidOut);
  const totalTransactions = earningsAgg[0]?.totalTransactions ?? 0;

  // 3. Fetch earnings breakdown per referred user
  const userEarningsMap = {};
  const earningsPerUser = await ReferralEarning.aggregate([
    { $match: { referrer: new mongoose.Types.ObjectId(userId), status: "COMPLETED" } },
    {
      $group: {
        _id: "$referredUser",
        earned: { $sum: "$commissionAmount" },
        salesCount: { $sum: 1 },
      },
    },
  ]);

  for (const item of earningsPerUser) {
    userEarningsMap[String(item._id)] = {
      earned: item.earned,
      salesCount: item.salesCount,
    };
  }

  // 4. Formatted list of referred friends
  const referralsList = referredUsers.map((u) => {
    const isOrganiser = u.roles?.includes("organiser");
    const userStats = userEarningsMap[String(u._id)] || { earned: 0, salesCount: 0 };
    return {
      id: String(u._id),
      name: `${u.firstName} ${u.surname}`.trim(),
      email: u.email,
      avatar: u.profilePicture?.url || null,
      date: u.referredAt || u.createdAt,
      isOrganiser,
      status: isOrganiser ? "Active Organiser" : "Registered",
      totalEarned: userStats.earned,
      salesCount: userStats.salesCount,
      reward: `₦${userStats.earned.toLocaleString()}`,
    };
  });

  // 5. Recent referral transactions
  const recentEarnings = await ReferralEarning.find({
    referrer: userId,
  })
    .populate("referredUser", "firstName surname email profilePicture")
    .populate("eventId", "title")
    .populate("eventCenterId", "venueName")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const recentTransactions = recentEarnings.map((item) => {
    const referredName = item.referredUser
      ? `${item.referredUser.firstName || ""} ${item.referredUser.surname || ""}`.trim()
      : "Referred Host";
    const itemTitle = item.eventId?.title || item.eventCenterId?.venueName || "Booking";

    return {
      id: String(item._id),
      referredUserName: referredName,
      title: `${referredName} - ${itemTitle}`,
      itemTitle,
      sourceType: item.sourceType,
      date: item.createdAt,
      amount: item.commissionAmount,
      formattedAmount: `₦${item.commissionAmount.toLocaleString()}`,
      saleAmount: item.totalAmount,
      platformFeeAmount: item.platformFeeAmount,
      commissionPercentage: item.commissionPercentage,
      status: item.status,
      bookingReference: item.bookingReference || `REF-${String(item._id).slice(-6).toUpperCase()}`,
    };
  });

  const payoutMethod = (user.bankDetails && user.vendorAccountCode) ? user.bankDetails : null;

  return {
    referralCode,
    referralLink: `munasaba:///refer?code=${encodeURIComponent(referralCode)}`,
    referredBy: referredByInfo,
    entryEligibility,
    stats: {
      totalEarned,
      formattedTotalEarned: `₦${totalEarned.toLocaleString()}`,
      ticketEarnings,
      formattedTicketEarnings: `₦${ticketEarnings.toLocaleString()}`,
      venueEarnings,
      formattedVenueEarnings: `₦${venueEarnings.toLocaleString()}`,
      pendingEarnings,
      formattedPendingEarnings: `₦${pendingEarnings.toLocaleString()}`,
      paidOut,
      formattedPaidOut: `₦${paidOut.toLocaleString()}`,
      availableBalance,
      formattedAvailableBalance: `₦${availableBalance.toLocaleString()}`,
      totalReferrals,
      organiserReferrals,
      totalTransactions,
    },
    payoutMethod,
    programSettings: {
      commissionPercentage: commissionPercent,
      durationDays,
      isEnabled: programEnabled,
      durationLabel: policy.duration.value === 0 ? "Lifetime Rewards" : `${policy.duration.value} ${policy.duration.unit.toLowerCase()} Commission Window`,
      duration: policy.duration,
      status: policy.status,
    },
    referrals: referralsList,
    recentTransactions,
  };
};

/**
 * Apply referral code for a user
 */
const applyReferralCode = async (userId, rawCode) => {
  if (!rawCode || typeof rawCode !== "string") {
    throw new Error("Referral code is required");
  }

  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error("Referral code is required");
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  if (user.referredBy) {
    throw new Error("You have already linked a referral code to your account");
  }
  const eligibility = await getEntryEligibility(user);
  if (!eligibility.canApply) throw new Error("The referral-code entry window has expired");

  if (user.referralCode && user.referralCode.toUpperCase() === code) {
    throw new Error("You cannot use your own referral code");
  }

  const referrer = await User.findOne({ referralCode: code, isActive: { $ne: false } });
  if (!referrer) {
    throw new Error("Invalid referral code. Please verify the code and try again.");
  }

  if (String(referrer._id) === String(userId)) {
    throw new Error("You cannot use your own referral code");
  }

  const linked = await User.findOneAndUpdate(
    { _id: userId, referredBy: null, $expr: { $lte: ["$NOW", eligibility.deadline] } },
    { $set: { referredBy: referrer._id, referredAt: new Date() } },
    { new: true }
  );
  if (!linked) throw new Error("You have already linked a referral code to your account");

  // Dispatch real-time notification to the referrer
  try {
    const organiserName = `${user.firstName || ""} ${user.surname || ""}`.trim() || "A new host";
    await dispatchNotification({
      recipient: referrer._id,
      sender: user._id,
      type: NOTIFICATION_TYPES.REFERRAL_REWARD,
      title: "New Referral Connected! 🎉",
      message: `${organiserName} linked your referral code. You will earn commission when they sell tickets or book venues!`,
      referenceId: user._id,
      referenceType: "User",
      data: {
        screen: "Referral",
        referredUserId: String(user._id),
      },
      email: {
        subject: `${organiserName} joined using your referral link! - Munasaba`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #111;">
            <h2 style="color: #00A699;">New Referral Added! 🎉</h2>
            <p><strong>${organiserName}</strong> has linked your referral code to their account.</p>
            <p>You will earn commission on their ticket sales and venue bookings.</p>
          </div>
        `,
      },
    });
  } catch (notifErr) {
    console.error("[REFERRAL] Error dispatching referral connection notification:", notifErr);
  }

  return {
    success: true,
    referrerName: `${referrer.firstName} ${referrer.surname}`.trim(),
    referrerCode: referrer.referralCode,
  };
};

module.exports = {
  ensureUserReferralCode,
  calculateAffiliateReward,
  processReferralCommission,
  recordBookingReferral,
  getReferralStats,
  applyReferralCode,
};
