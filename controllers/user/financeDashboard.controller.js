const User = require("../../models/user/user.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const { getPaymentGateway } = require("../../services/payment");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const gateway = getPaymentGateway();

const EventBooking = require("../../models/user/eventBooking.schema");
const Event = require("../../models/user/event.schema");

/**
 * @desc    Get finance stats, balance, weekly trends, and recent transactions
 * @route   GET /api/finance-dashboard/stats
 * @access  Private
 */
const getFinanceStats = async (req, res) => {
  const userId = req.user.id;
  const userObjectId = new mongoose.Types.ObjectId(userId);

  try {
    const user = await User.findById(userId).select("bankDetails vendorAccountCode");

    // 1. Get all event IDs created or co-organised by the user
    const userEvents = await Event.find({
      $or: [{ createdBy: userObjectId }, { coOrganisers: userObjectId }],
    }).select("_id title").lean();
    const eventIds = userEvents.map((e) => e._id);
    const eventMap = new Map(userEvents.map((e) => [e._id.toString(), e.title]));

    // Date boundaries for analytics
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Start of current week (Monday)
    const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday...
    const distanceToMonday = (dayOfWeek + 6) % 7;
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    // Start of current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 2. Aggregate EventCenterBookings (Venue Hires)
    const venueStats = await EventCenterBooking.aggregate([
      { $match: { organiser: userObjectId } },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$paymentStatus", "COMPLETED"] },
                { $ifNull: ["$totalPrice.amount", 0] },
                0,
              ],
            },
          },
          pendingRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$paymentStatus", "PENDING"] },
                { $ifNull: ["$totalPrice.amount", 0] },
                0,
              ],
            },
          },
          completedBookingsCount: {
            $sum: {
              $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, 1, 0],
            },
          },
          thisMonthRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentStatus", "COMPLETED"] },
                    { $gte: ["$createdAt", startOfMonth] },
                  ],
                },
                { $ifNull: ["$totalPrice.amount", 0] },
                0,
              ],
            },
          },
          thisWeekRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentStatus", "COMPLETED"] },
                    { $gte: ["$createdAt", startOfWeek] },
                  ],
                },
                { $ifNull: ["$totalPrice.amount", 0] },
                0,
              ],
            },
          },
          todayRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$paymentStatus", "COMPLETED"] },
                    { $gte: ["$createdAt", startOfToday] },
                  ],
                },
                { $ifNull: ["$totalPrice.amount", 0] },
                0,
              ],
            },
          },
        },
      },
    ]);

    // 3. Aggregate EventBookings (Ticket Sales - note: totalAmount is in kobo so divide by 100)
    let ticketStats = [{
      totalRevenue: 0,
      pendingRevenue: 0,
      completedTicketsCount: 0,
      thisMonthRevenue: 0,
      thisWeekRevenue: 0,
      todayRevenue: 0,
    }];

    if (eventIds.length > 0) {
      ticketStats = await EventBooking.aggregate([
        { $match: { eventId: { $in: eventIds } } },
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "COMPLETED"] },
                  { $divide: [{ $ifNull: ["$totalAmount", 0] }, 100] },
                  0,
                ],
              },
            },
            pendingRevenue: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "PENDING"] },
                  { $divide: [{ $ifNull: ["$totalAmount", 0] }, 100] },
                  0,
                ],
              },
            },
            completedTicketsCount: {
              $sum: {
                $cond: [{ $eq: ["$paymentStatus", "COMPLETED"] }, 1, 0],
              },
            },
            thisMonthRevenue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paymentStatus", "COMPLETED"] },
                      { $gte: ["$createdAt", startOfMonth] },
                    ],
                  },
                  { $divide: [{ $ifNull: ["$totalAmount", 0] }, 100] },
                  0,
                ],
              },
            },
            thisWeekRevenue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paymentStatus", "COMPLETED"] },
                      { $gte: ["$createdAt", startOfWeek] },
                    ],
                  },
                  { $divide: [{ $ifNull: ["$totalAmount", 0] }, 100] },
                  0,
                ],
              },
            },
            todayRevenue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paymentStatus", "COMPLETED"] },
                      { $gte: ["$createdAt", startOfToday] },
                    ],
                  },
                  { $divide: [{ $ifNull: ["$totalAmount", 0] }, 100] },
                  0,
                ],
              },
            },
          },
        },
      ]);
    }

    const venueData = venueStats[0] || {
      totalRevenue: 0,
      pendingRevenue: 0,
      completedBookingsCount: 0,
      thisMonthRevenue: 0,
      thisWeekRevenue: 0,
      todayRevenue: 0,
    };

    const ticketData = ticketStats[0] || {
      totalRevenue: 0,
      pendingRevenue: 0,
      completedTicketsCount: 0,
      thisMonthRevenue: 0,
      thisWeekRevenue: 0,
      todayRevenue: 0,
    };

    const totalEarnings = (venueData.totalRevenue || 0) + (ticketData.totalRevenue || 0);
    const pendingPayouts = (venueData.pendingRevenue || 0) + (ticketData.pendingRevenue || 0);
    const thisMonthEarnings = (venueData.thisMonthRevenue || 0) + (ticketData.thisMonthRevenue || 0);
    const thisWeekEarnings = (venueData.thisWeekRevenue || 0) + (ticketData.thisWeekRevenue || 0);
    const todayEarnings = (venueData.todayRevenue || 0) + (ticketData.todayRevenue || 0);

    // 4. Calculate Weekly Trends (Mon - Sun for current week)
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weeklyTrends = [];

    // Query this week's venue bookings
    const thisWeekVenueBookings = await EventCenterBooking.find({
      organiser: userObjectId,
      paymentStatus: "COMPLETED",
      createdAt: { $gte: startOfWeek },
    }).select("totalPrice createdAt").lean();

    // Query this week's ticket bookings
    const thisWeekTicketBookings = eventIds.length > 0
      ? await EventBooking.find({
          eventId: { $in: eventIds },
          paymentStatus: "COMPLETED",
          createdAt: { $gte: startOfWeek },
        }).select("totalAmount createdAt").lean()
      : [];

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(startOfWeek);
      dayDate.setDate(startOfWeek.getDate() + i);
      const nextDayDate = new Date(dayDate);
      nextDayDate.setDate(dayDate.getDate() + 1);

      const dayVenueSum = thisWeekVenueBookings
        .filter((b) => b.createdAt >= dayDate && b.createdAt < nextDayDate)
        .reduce((acc, b) => acc + (b.totalPrice?.amount || 0), 0);

      const dayTicketSum = thisWeekTicketBookings
        .filter((b) => b.createdAt >= dayDate && b.createdAt < nextDayDate)
        .reduce((acc, b) => acc + (b.totalAmount ? b.totalAmount / 100 : 0), 0);

      const dayTotal = dayVenueSum + dayTicketSum;

      // Format human-friendly value like ₦12k or ₦500
      let formattedVal = "₦0";
      if (dayTotal >= 1000000) {
        formattedVal = `₦${(dayTotal / 1000000).toFixed(1)}M`;
      } else if (dayTotal >= 1000) {
        formattedVal = `₦${Math.round(dayTotal / 1000)}k`;
      } else if (dayTotal > 0) {
        formattedVal = `₦${dayTotal}`;
      }

      weeklyTrends.push({
        day: dayNames[i],
        date: dayDate.toISOString(),
        rawAmount: dayTotal,
        value: formattedVal,
      });
    }

    // 5. Fetch Recent Unified Transactions (Venue Bookings + Ticket Sales)
    const [recentVenueBookings, recentTicketBookings] = await Promise.all([
      EventCenterBooking.find({ organiser: userObjectId })
        .populate("eventCenter", "venueName")
        .populate("buyer", "fullName email")
        .sort({ createdAt: -1 })
        .limit(15)
        .lean(),
      eventIds.length > 0
        ? EventBooking.find({ eventId: { $in: eventIds } })
            .populate("buyer", "fullName email")
            .sort({ createdAt: -1 })
            .limit(15)
            .lean()
        : [],
    ]);

    const formattedVenueTransactions = recentVenueBookings.map((b) => ({
      id: b._id.toString(),
      title: `Venue Hire - ${b.eventCenter?.venueName || "Event Venue"}`,
      category: "VENUE_BOOKING",
      date: b.createdAt,
      amount: b.totalPrice?.amount || 0,
      type: "in",
      status: b.paymentStatus || "COMPLETED",
      reference: b.paymentReference || b.paystackReference || `VEN_${b._id.toString().slice(-6)}`,
      customerName: b.guestDetails?.fullName || b.buyer?.fullName || "Guest Customer",
      customerEmail: b.guestDetails?.email || b.buyer?.email || "",
      bookingUnit: b.bookingUnit || "day",
      duration: b.duration || 1,
    }));

    const formattedTicketTransactions = recentTicketBookings.map((t) => {
      const eventTitle = eventMap.get(t.eventId?.toString()) || "Event";
      const totalTicketsCount = (t.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
      return {
        id: t._id.toString(),
        title: `Ticket - ${eventTitle}`,
        category: "TICKET_SALE",
        date: t.createdAt,
        amount: (t.totalAmount || 0) / 100,
        type: "in",
        status: t.paymentStatus || "COMPLETED",
        reference: t.paymentReference || t.paystackReference || `TCK_${t._id.toString().slice(-6)}`,
        customerName: t.guestDetails?.fullName || t.buyer?.fullName || "Ticket Buyer",
        customerEmail: t.guestDetails?.email || t.buyer?.email || "",
        ticketCount: totalTicketsCount,
        items: t.items || [],
      };
    });

    // Merge and sort newest first
    const allTransactions = [...formattedVenueTransactions, ...formattedTicketTransactions]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 20);

    const availableBalance = totalEarnings;

    res.status(200).json({
      success: true,
      data: {
        balance: {
          available: availableBalance,
          totalEarnings,
          pendingPayouts,
          successfulPayouts: 0,
          thisMonthEarnings,
          thisWeekEarnings,
          todayEarnings,
        },
        breakdown: {
          ticketRevenue: ticketData.totalRevenue || 0,
          ticketSalesCount: ticketData.completedTicketsCount || 0,
          venueRevenue: venueData.totalRevenue || 0,
          venueBookingsCount: venueData.completedBookingsCount || 0,
        },
        weeklyTrends,
        transactions: allTransactions,
        payoutMethod: user.bankDetails && user.vendorAccountCode ? user.bankDetails : null,
      },
    });
  } catch (error) {
    console.error("[GET FINANCE STATS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching finance stats" });
  }
};

/**
 * @desc    Get list of banks from Paystack
 * @route   GET /api/finance-dashboard/banks
 * @access  Private
 */
const getBanksList = async (req, res) => {
  try {
    const banks = await gateway.getBanks();
    res.status(200).json({ success: true, data: banks });
  } catch (error) {
    console.error("[GET BANKS ERROR]", error);
    res.status(500).json({ success: false, message: "Error fetching banks" });
  }
};

/**
 * @desc    Verify bank account details
 * @route   POST /api/finance-dashboard/verify-account
 * @access  Private
 */
const verifyAccount = async (req, res) => {
  const { accountNumber, bankCode } = req.body;
  if (!accountNumber || !bankCode) {
    return res.status(400).json({ success: false, message: "Account number and bank code required" });
  }

  try {
    const accountInfo = await gateway.resolveBankAccount(accountNumber, bankCode);
    res.status(200).json({ success: true, data: accountInfo });
  } catch (error) {
    console.error("[VERIFY ACCOUNT ERROR]", error);
    res.status(400).json({ success: false, message: "Could not verify account details" });
  }
};

/**
 * @desc    Verify user password for sensitive operations
 * @route   POST /api/finance-dashboard/verify-password
 * @access  Private
 */
const verifyPassword = async (req, res) => {
  const userId = req.user.id;
  const { password } = req.body;

  try {
    const user = await User.findById(userId).select("password authProvider");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Google-only users authenticate via their session/OAuth token
    if (user.authProvider === "google" && !user.password) {
      return res.status(200).json({
        success: true,
        message: "Identity verified via Google authentication",
        isGoogleUser: true,
      });
    }

    if (!password) {
      return res.status(400).json({ success: false, message: "Password is required" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Incorrect password" });
    }

    res.status(200).json({ success: true, message: "Password verified successfully" });
  } catch (error) {
    console.error("[VERIFY PASSWORD ERROR]", error);
    res.status(500).json({ success: false, message: "Server error verifying password" });
  }
};

/**
 * @desc    Setup Paystack Subaccount
 * @route   POST /api/finance-dashboard/setup-subaccount
 * @access  Private
 */
const setupSubaccount = async (req, res) => {
  const userId = req.user.id;
  const { bankCode, accountNumber, accountName, bankName } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Block if user already has a vendor account — must remove first
    if (user.vendorAccountCode) {
      return res.status(400).json({
        success: false,
        message: "An existing payout method must be removed before adding a new one.",
      });
    }

    // Determine platform fee percent from platform settings
    const PlatformFees = require("../../models/admin/platformFees.schema");
    const fees = await PlatformFees.findOne({ key: "platform_fees" }).lean();
    const platformFeePercent = Number(fees?.eventCommission ?? fees?.eventCenterCommission ?? 10);

    // Create vendor account via payment gateway
    const vendorData = await gateway.createVendorAccount({
      businessName: user.fullName || accountName,
      bankCode: bankCode,
      accountNumber: accountNumber,
      platformFeePercent,
    });

    // Save details to user profile
    user.vendorAccountCode = vendorData.vendorCode;
    user.bankDetails = {
      accountName,
      accountNumber,
      bankName,
      bankCode,
    };
    await user.save();

    res.status(200).json({
      success: true,
      message: "Payout method connected successfully",
      data: user.bankDetails,
    });
  } catch (error) {
    console.error("[SETUP SUBACCOUNT ERROR]", error);
    res.status(500).json({ success: false, message: error.message || "Failed to setup payout method" });
  }
};

/**
 * @desc    Remove Paystack Subaccount / payout method (requires prior password verification)
 * @route   DELETE /api/finance-dashboard/remove-subaccount
 * @access  Private
 */
const removeSubaccount = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.vendorAccountCode && !user.bankDetails) {
      return res.status(400).json({ success: false, message: "No payout method linked to remove" });
    }

    // 1. Deactivate the vendor account on payment gateway if exists
    if (user.vendorAccountCode) {
      try {
        await gateway.deactivateVendorAccount(user.vendorAccountCode);
      } catch (gatewayError) {
        // Log error, but allow DB cleanup so user doesn't get stuck
        console.error("[GATEWAY DEACTIVATE VENDOR ACCOUNT ERROR]", gatewayError.message || gatewayError);
      }
    }

    // 2. Clear vendor account and bank details cleanly using $unset
    await User.findByIdAndUpdate(userId, {
      $unset: { vendorAccountCode: 1, bankDetails: 1 }
    });

    res.status(200).json({
      success: true,
      message: "Payout method removed and deactivated successfully",
    });
  } catch (error) {
    console.error("[REMOVE SUBACCOUNT ERROR]", error);
    res.status(500).json({ success: false, message: "Failed to remove payout method" });
  }
};

module.exports = {
  getFinanceStats,
  getBanksList,
  verifyAccount,
  verifyPassword,
  setupSubaccount,
  removeSubaccount,
};
