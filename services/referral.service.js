const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/client/user.schema");
const ReferralEarning = require("../models/client/referralEarning.schema");
const Event = require("../models/client/event.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const PlatformFees = require("../models/management/platformFees.schema");
const { dispatchNotification } = require("./notification");
const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

/**
 * Generate a unique, short, human-friendly uppercase referral code (e.g. MN4X9K)
 */
const generateReferralCode = async (user) => {
  let isUnique = false;
  let code = "";
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    attempts++;
    const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    code = `MN${randomSuffix}`;

    const existing = await User.findOne({ referralCode: code }).select("_id").lean();
    if (!existing) {
      isUnique = true;
    }
  }

  // Fallback if collision
  if (!isUnique) {
    code = `MN${Date.now().toString(36).toUpperCase().slice(-6)}`;
  }

  return code;
};

/**
 * Ensure user has a referral code assigned. Generates and saves if missing.
 */
const ensureUserReferralCode = async (userDocOrId) => {
  let user = typeof userDocOrId === "object" ? userDocOrId : await User.findById(userDocOrId);
  if (!user) return null;

  if (!user.referralCode) {
    user.referralCode = await generateReferralCode(user);
    await user.save();
  }

  return user.referralCode;
};

/**
 * Process referral commission when a referred organiser sells a ticket or gets a venue booking.
 * Idempotent: safe to be called multiple times for the same booking.
 * 
 * @param {Object} params
 * @param {string|ObjectId} params.organiserId - The organiser who made the sale
 * @param {string} params.sourceType - "EVENT_TICKET" | "EVENT_CENTER_BOOKING"
 * @param {string|ObjectId} params.bookingId - EventBooking or EventCenterBooking ID
 * @param {string} params.bookingReference - Payment or booking reference
 * @param {number} params.totalAmount - Total price of ticket or booking in Naira (NGN)
 * @param {string|ObjectId} [params.eventId] - Event ID if applicable
 * @param {string|ObjectId} [params.eventCenterId] - EventCenter ID if applicable
 */
const processReferralCommission = async ({
  organiserId,
  sourceType,
  bookingId,
  bookingReference,
  totalAmount,
  eventId = null,
  eventCenterId = null,
}) => {
  try {
    if (!organiserId || !bookingReference || !totalAmount || totalAmount <= 0) {
      return null;
    }

    // 1. Fetch Organiser
    const organiser = await User.findById(organiserId)
      .select("firstName surname email referredBy referredAt createdAt roles")
      .lean();

    if (!organiser || !organiser.referredBy) {
      // Organiser was not referred by anyone
      return null;
    }

    const referrerId = String(organiser.referredBy);
    if (referrerId === String(organiserId)) {
      // Prevent self-referral
      return null;
    }

    // 2. Fetch Referrer
    const referrer = await User.findById(referrerId)
      .select("firstName surname email isActive")
      .lean();

    if (!referrer || referrer.isActive === false) {
      return null;
    }

    // 3. Fetch Platform Fees & Referral Settings
    const platformFees = await PlatformFees.findOneAndUpdate(
      { key: "platform_fees" },
      { $setOnInsert: { key: "platform_fees" } },
      { upsert: true, new: true }
    ).lean();

    if (platformFees.referralProgramEnabled === false) {
      return null;
    }

    const commissionPercent = Number(platformFees.referralCommission ?? 5);
    if (commissionPercent <= 0) {
      return null;
    }

    // 4. Validate Referral Duration Window
    const durationDays = Number(platformFees.referralDurationDays ?? 90);
    if (durationDays > 0) {
      const referralStart = new Date(organiser.referredAt || organiser.createdAt || Date.now());
      const now = new Date();
      const elapsedDays = (now.getTime() - referralStart.getTime()) / (1000 * 60 * 60 * 24);

      if (elapsedDays > durationDays) {
        console.log(`[REFERRAL] Commission expired for organiser ${organiserId} (referred ${Math.round(elapsedDays)} days ago, window is ${durationDays} days)`);
        return null;
      }
    }

    // 5. Calculate Commission Amount in Naira
    const commissionAmount = Math.round(((totalAmount * commissionPercent) / 100) * 100) / 100;
    if (commissionAmount <= 0) {
      return null;
    }

    // 6. Check for existing commission record (Idempotency)
    const existing = await ReferralEarning.findOne({
      bookingReference,
      referrer: referrerId,
      sourceType,
    });

    if (existing) {
      console.log(`[REFERRAL] Commission already recorded for booking ${bookingReference}`);
      return existing;
    }

    // 7. Create ReferralEarning Record
    let earning;
    try {
      earning = await ReferralEarning.create({
        referrer: referrerId,
        referredUser: organiserId,
        sourceType,
        eventId: eventId || null,
        eventCenterId: eventCenterId || null,
        bookingId,
        bookingReference,
        totalAmount,
        commissionPercentage: commissionPercent,
        commissionAmount,
        status: "COMPLETED",
        currency: "NGN",
      });
    } catch (err) {
      if (err.code === 11000) {
        // Race condition: already created
        return await ReferralEarning.findOne({
          bookingReference,
          referrer: referrerId,
          sourceType,
        });
      }
      throw err;
    }

    // 8. Atomically increment referrer's total referral earnings
    await User.findByIdAndUpdate(referrerId, {
      $inc: { referralEarnings: commissionAmount },
    });

    // 9. Dispatch Real-Time Notification & Email to Referrer
    try {
      const organiserName = `${organiser.firstName || ""} ${organiser.surname || ""}`.trim() || "Your referred organiser";
      const itemDescription = sourceType === "EVENT_TICKET" ? "ticket sale" : "event center booking";
      const formattedAmount = `₦${commissionAmount.toLocaleString()}`;

      await dispatchNotification({
        recipient: referrerId,
        sender: organiserId,
        type: NOTIFICATION_TYPES.REFERRAL_REWARD,
        title: "Referral Reward Earned! 💰",
        message: `You earned ${formattedAmount} (${commissionPercent}%) from ${organiserName}'s ${itemDescription}!`,
        referenceId: earning._id,
        referenceType: "ReferralEarning",
        data: {
          screen: "Referral",
          earningId: String(earning._id),
          amount: String(commissionAmount),
        },
        email: {
          subject: `You earned ${formattedAmount} referral commission! - Munasaba`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #111;">
              <h2 style="color: #00A699;">Congratulations! 🎉</h2>
              <p>You earned a referral commission of <strong>${formattedAmount}</strong> (${commissionPercent}%) on Munasaba.</p>
              <p><strong>Organiser:</strong> ${organiserName}</p>
              <p><strong>Activity:</strong> ${sourceType === "EVENT_TICKET" ? "Event Ticket Sale" : "Venue Booking"}</p>
              <p><strong>Total Sale Value:</strong> ₦${totalAmount.toLocaleString()}</p>
              <p style="margin-top: 24px;">The rewards have been added to your Munasaba balance.</p>
            </div>
          `,
        },
      });
    } catch (notifErr) {
      console.error("[REFERRAL] Error dispatching reward notification:", notifErr);
    }

    console.log(`[REFERRAL] Successfully credited ${commissionAmount} NGN to referrer ${referrerId} for booking ${bookingReference}`);
    return earning;
  } catch (error) {
    console.error("[REFERRAL COMMISSION ERROR]", error);
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

  // Fetch platform settings for commission and duration
  const platformFees = await PlatformFees.findOneAndUpdate(
    { key: "platform_fees" },
    { $setOnInsert: { key: "platform_fees" } },
    { upsert: true, new: true }
  ).lean();

  const commissionPercent = Number(platformFees.referralCommission ?? 5);
  const durationDays = Number(platformFees.referralDurationDays ?? 90);
  const programEnabled = platformFees.referralProgramEnabled !== false;

  // 1. Total referred users & organisers
  const referredUsers = await User.find({ referredBy: userId })
    .select("firstName surname email profilePicture roles createdAt")
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

  const totalEarned = earningsAgg[0]?.totalEarned ?? user.referralEarnings ?? 0;
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
      date: u.createdAt,
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
      commissionPercentage: item.commissionPercentage,
      status: item.status,
      bookingReference: item.bookingReference || `REF-${String(item._id).slice(-6).toUpperCase()}`,
    };
  });

  const payoutMethod = (user.bankDetails && user.vendorAccountCode) ? user.bankDetails : null;

  return {
    referralCode,
    referralLink: `https://munasabahub.com/refer/${referralCode}`,
    referredBy: referredByInfo,
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
      durationLabel: durationDays === 0 ? "Lifetime Rewards" : `${durationDays} Days Commission Window`,
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
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  if (user.referredBy) {
    throw new Error("You have already linked a referral code to your account");
  }

  if (user.referralCode && user.referralCode.toUpperCase() === code) {
    throw new Error("You cannot use your own referral code");
  }

  const referrer = await User.findOne({ referralCode: code });
  if (!referrer) {
    throw new Error("Invalid referral code. Please verify the code and try again.");
  }

  if (String(referrer._id) === String(userId)) {
    throw new Error("You cannot use your own referral code");
  }

  user.referredBy = referrer._id;
  user.referredAt = new Date();
  await user.save();

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
  generateReferralCode,
  ensureUserReferralCode,
  processReferralCommission,
  getReferralStats,
  applyReferralCode,
};
