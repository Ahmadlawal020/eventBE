const User = require("../../models/client/user.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const { getPaymentGateway } = require("../../services/payment");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const gateway = getPaymentGateway();

const EventBooking = require("../../models/client/eventBooking.schema");
const Event = require("../../models/client/event.schema");
const { revenueBookingFilter } = require("../../services/eventRevenue.service");

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

    // Apply current finance permissions before every aggregate and transaction read.
    const userEvents = await require("../../services/eventFinanceAccess.service").financialEvents(userObjectId);
    const eventIds = userEvents.map((e) => e._id);
    const eventMap = new Map(userEvents.map((e) => [e._id.toString(), e.title]));

    // Resolve owned + co-organiser venues with current VIEW_FINANCES / ALL_ACCESS permission
    const EventCenter = require("../../models/client/eventCenter.schema");
    const CoOrganiserInvitation = require("../../models/client/coOrganiserInvitation.schema");
    const candidateVenues = await EventCenter.find({
      $or: [{ createdBy: userObjectId }, { coOrganisers: userObjectId }],
    }).lean();
    const venueInvites = candidateVenues.some((v) => String(v.createdBy) !== String(userId))
      ? await CoOrganiserInvitation.find({
          coOrganiser: userObjectId,
          status: "ACCEPTED",
          permissions: { $in: ["VIEW_FINANCES", "ALL_ACCESS"] },
        }).lean()
      : [];
    const ownedVenues = candidateVenues.filter((v) => {
      if (String(v.createdBy) === String(userId)) return true;
      return venueInvites.some(
        (inv) =>
          String(inv.host) === String(v.createdBy) &&
          (inv.listings || []).some((l) => String(l.listingId) === String(v._id)),
      );
    });
    const financeVenueIds = ownedVenues.map((v) => v._id);
    const venueMatch =
      financeVenueIds.length > 0
        ? { $or: [{ organiser: userObjectId }, { eventCenter: { $in: financeVenueIds } }] }
        : { organiser: userObjectId };

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
      { $match: venueMatch },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$paymentStatus", "COMPLETED"] },
                { $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalPrice.amount", "$totalPrice.amount"] }] },
                0,
              ],
            },
          },
          pendingRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$paymentStatus", "PENDING"] },
                { $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalPrice.amount", "$totalPrice.amount"] }] },
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
                { $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalPrice.amount", "$totalPrice.amount"] }] },
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
                { $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalPrice.amount", "$totalPrice.amount"] }] },
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
                { $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalPrice.amount", "$totalPrice.amount"] }] },
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
        { $match: revenueBookingFilter(eventIds, { paymentStatus: { $in: ["COMPLETED", "PENDING"] } }) },
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "COMPLETED"] },
                  { $divide: [{ $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalAmount", "$totalAmount"] }] }, 100] },
                  0,
                ],
              },
            },
            pendingRevenue: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentStatus", "PENDING"] },
                  { $divide: [{ $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalAmount", "$totalAmount"] }] }, 100] },
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
                  { $divide: [{ $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalAmount", "$totalAmount"] }] }, 100] },
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
                  { $divide: [{ $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalAmount", "$totalAmount"] }] }, 100] },
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
                  { $divide: [{ $ifNull: ["$organiserPayoutAmount", { $ifNull: ["$subtotalAmount", "$totalAmount"] }] }, 100] },
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

    let totalEarnings = (venueData.totalRevenue || 0) + (ticketData.totalRevenue || 0);
    const payoutRecords = await require("../../models/client/venuePayout.schema")
      .find({ organiser: userId })
      .populate({
        path: "booking",
        select: "eventCenter ticketNumber",
        populate: { path: "eventCenter", select: "venueName" },
      })
      .sort({ createdAt: -1 })
      .lean();
    const directBookings = await require("../../services/manualBookingRead.service").getManualBookings(ownedVenues);
    const venueFinance = require("../../services/venueFinanceSummary.service").venueFinanceSummary(payoutRecords, directBookings);
    const venueMoneyData = await require("../../services/venueMoney.service").loadVenueMoney(ownedVenues.map(v => v._id), directBookings);
    const ngnMoney = rows => rows.find(r => r.currency === "NGN")?.netReceipts || 0;
    venueData.totalRevenue = ngnMoney(venueMoneyData.currencies);
    venueData.thisMonthRevenue = ngnMoney(venueMoneyData.period(startOfMonth));
    venueData.thisWeekRevenue = ngnMoney(venueMoneyData.period(startOfWeek));
    venueData.todayRevenue = ngnMoney(venueMoneyData.period(startOfToday));
    totalEarnings = venueData.totalRevenue + (ticketData.totalRevenue || 0);
    const naira = venueFinance.find(row => row.currency === "NGN");
    const pendingPayouts = naira?.pendingPayouts || 0;
    const thisMonthEarnings = (venueData.thisMonthRevenue || 0) + (ticketData.thisMonthRevenue || 0);
    const thisWeekEarnings = (venueData.thisWeekRevenue || 0) + (ticketData.thisWeekRevenue || 0);
    const todayEarnings = (venueData.todayRevenue || 0) + (ticketData.todayRevenue || 0);

    // 4. Calculate Weekly Trends (Mon - Sun for current week)
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weeklyTrends = [];

    // Query this week's venue bookings
    const thisWeekVenueBookings = await EventCenterBooking.find({
      ...venueMatch,
      paymentStatus: "COMPLETED",
      createdAt: { $gte: startOfWeek },
    }).select("totalPrice subtotalPrice organiserPayoutAmount createdAt").lean();

    // Query this week's ticket bookings
    const thisWeekTicketBookings = eventIds.length > 0
      ? await EventBooking.find({
          ...revenueBookingFilter(eventIds),
          createdAt: { $gte: startOfWeek },
        }).select("totalAmount subtotalAmount organiserPayoutAmount createdAt").lean()
      : [];

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(startOfWeek);
      dayDate.setDate(startOfWeek.getDate() + i);
      const nextDayDate = new Date(dayDate);
      nextDayDate.setDate(dayDate.getDate() + 1);

      const dayVenueSum = ngnMoney(venueMoneyData.period(dayDate, new Date(+nextDayDate - 1)));

      const dayTicketSum = thisWeekTicketBookings
        .filter((b) => b.createdAt >= dayDate && b.createdAt < nextDayDate)
        .reduce((acc, b) => acc + ((b.organiserPayoutAmount ?? b.subtotalAmount ?? b.totalAmount ?? 0) / 100), 0);

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
      EventCenterBooking.find(venueMatch)
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

    const formattedVenueTransactions = recentVenueBookings.map((b) => {
      const netAmount =
        b.organiserPayoutAmount ??
        b.subtotalPrice?.amount ??
        Math.max(0, (b.totalPrice?.amount ?? 0) - (b.platformFeeAmount ?? 0));
      const modeLabel = b.bookingMode === "REVIEW" ? "Review Booking" : "Instant Booking";
      return {
        id: b._id.toString(),
        title: `${modeLabel} - ${b.eventCenter?.venueName || "Event Venue"}`,
        category: "VENUE_BOOKING",
        subCategory: b.bookingMode === "REVIEW" ? "REVIEW_BOOKING" : "INSTANT_BOOKING",
        date: b.createdAt,
        amount: netAmount,
        type: "in",
        status: b.paymentStatus || "COMPLETED",
        reference: b.paymentReference || b.paystackReference || `VEN_${b._id.toString().slice(-6)}`,
        customerName: b.guestDetails?.fullName || b.buyer?.fullName || "Guest Customer",
        customerEmail: b.guestDetails?.email || b.buyer?.email || "",
        bookingUnit: b.bookingUnit || "day",
        duration: b.duration || 1,
      };
    });

    const formattedTicketTransactions = recentTicketBookings.map((t) => {
      const eventTitle = eventMap.get(t.eventId?.toString()) || "Event";
      const totalTicketsCount = (t.items || []).reduce((sum, item) => sum + (item.quantity || 1), 0);
      return {
        id: t._id.toString(),
        title: `Ticket - ${eventTitle}`,
        category: "TICKET_SALE",
        date: t.createdAt,
        amount: (t.organiserPayoutAmount ?? t.subtotalAmount ?? t.totalAmount ?? 0) / 100,
        type: "in",
        status: t.paymentResolutionRequired ? "UNDER_REVIEW" : t.status === "CANCELLED" && t.paymentStatus === "COMPLETED" ? "CANCELLED" : t.paymentStatus || "COMPLETED",
        reference: t.paymentReference || t.paystackReference || `TCK_${t._id.toString().slice(-6)}`,
        customerName: t.guestDetails?.fullName || t.buyer?.fullName || "Ticket Buyer",
        customerEmail: t.guestDetails?.email || t.buyer?.email || "",
        ticketCount: totalTicketsCount,
        items: t.items || [],
      };
    });

    // Merge and sort newest first
    const refundMatch =
      financeVenueIds.length > 0
        ? { $or: [{ organiser: userObjectId }, { eventCenterId: { $in: financeVenueIds } }], markedPaidAt: { $type: "date" } }
        : { organiser: userObjectId, markedPaidAt: { $type: "date" } };
    const recordedRefunds = await require("../../models/client/eventCenterRefund.schema").find(refundMatch)
      .select("eventCenterId amountMinor currency markedPaidAt status organiserReference")
      .populate("eventCenterId", "venueName").sort({ markedPaidAt: -1 }).limit(15).lean();
    const refundTransactions = recordedRefunds.map(r => ({
      id: String(r._id), title: "Cancellation Refund - " + (r.eventCenterId?.venueName || "Venue booking"), category: "VENUE_REFUND",
      subCategory: "CANCELLATION_REFUND",
      date: r.markedPaidAt, amount: r.amountMinor / 100, currency: r.currency, type: "out", status: r.status,
      reference: r.organiserReference || "DIRECT-" + r._id,
    }));

    // Build ledger rows for manual booking deposits, reschedule payments (fee-exempt), and reschedule/manual refunds
    const venueNameById = new Map(ownedVenues.map((v) => [String(v._id), v.venueName || "Event Venue"]));
    const manualOpeningTransactions = directBookings
      .filter((b) => {
        const op = (venueMoneyData.allOperations || []).find((o) => String(o.bookingId) === String(b._id));
        const openingMinor = op?.openingPaidMinor ?? Math.round((b.paymentStatus === "COMPLETED" ? b.totalPrice?.amount || 0 : b.depositAmount || 0) * 100);
        return openingMinor > 0;
      })
      .map((b) => {
        const op = (venueMoneyData.allOperations || []).find((o) => String(o.bookingId) === String(b._id));
        const openingMinor = op?.openingPaidMinor ?? Math.round((b.paymentStatus === "COMPLETED" ? b.totalPrice?.amount || 0 : b.depositAmount || 0) * 100);
        const vName = b.eventCenter?.venueName || venueNameById.get(String(b.eventCenter?._id || b.eventCenter)) || "Event Venue";
        return {
          id: `manual-open-${b._id}`,
          title: `Manual Booking - ${vName}`,
          category: "VENUE_BOOKING",
          subCategory: "MANUAL_BOOKING",
          date: b.createdAt || op?.createdAt || new Date(),
          amount: openingMinor / 100,
          currency: b.totalPrice?.currency || "NGN",
          type: "in",
          status: "COMPLETED",
          reference: String(b._id),
          customerName: b.guestName || b.guestDetails?.fullName || "Walk-in Client",
          customerEmail: b.guestDetails?.email || "",
        };
      });

    const operationsTransactions = (venueMoneyData.allOperations || []).flatMap((op) => {
      const vName = venueNameById.get(String(op.eventCenter)) || "Event Venue";
      const isManualBooking = String(op.bookingId || "").startsWith("manual-");
      const guestName = op.bookingSnapshot?.guestName || op.bookingSnapshot?.guestDetails?.fullName || "Client";
      const currency = op.agreedPrice?.currency || op.bookingSnapshot?.totalPrice?.currency || "NGN";
      return (op.payments || [])
        .filter((p) => ["PAYMENT", "REFUND"].includes(p.kind))
        .map((p) => {
          const isRefund = p.kind === "REFUND";
          const netMinor = isRefund
            ? p.amountMinor || 0
            : Math.max(0, (p.amountMinor || 0) - (p.platformFeeMinor || 0));
          const isPaystackReschedule = !isRefund && String(p.method || "").toUpperCase() === "PAYSTACK";
          const title = isRefund
            ? `${op.rescheduleAdjustment ? "Reschedule Refund" : "Manual Refund"} - ${vName}`
            : op.rescheduleAdjustment
              ? `${isPaystackReschedule ? "Instant Reschedule Top-up" : "Direct Reschedule Payment"} - ${vName}`
              : `Manual Booking Payment - ${vName}`;
          return {
            id: `op-${op._id}-${p.id}`,
            title,
            category: isRefund ? "VENUE_REFUND" : "VENUE_BOOKING",
            subCategory: isRefund
              ? "RESCHEDULE_REFUND"
              : op.rescheduleAdjustment
                ? isPaystackReschedule
                  ? "RESCHEDULE_PLATFORM"
                  : "RESCHEDULE_DIRECT"
                : isManualBooking
                  ? "MANUAL_BOOKING"
                  : "DIRECT_PAYMENT",
            date: p.at || op.updatedAt || new Date(),
            amount: netMinor / 100,
            currency,
            type: isRefund ? "out" : "in",
            status: "COMPLETED",
            reference: p.reference || p.id,
            customerName: guestName,
          };
        });
    });
    const payoutHistory = payoutRecords
      .filter((p) => p.status !== "CANCELLED")
      .map((p) => {
        const venueTitle = p.booking?.eventCenter?.venueName || "Venue booking";
        const normalizedStatus =
          p.status === "SUCCESS"
            ? "COMPLETED"
            : p.status === "FAILED" || p.status === "NEEDS_ATTENTION"
              ? "FAILED"
              : "PENDING";
        return {
          id: String(p._id),
          title: `Bank Payout - ${venueTitle}`,
          category: "VENUE_PAYOUT",
          date: p.updatedAt || p.createdAt,
          amount: (p.amountMinor || 0) / 100,
          currency: p.currency || "NGN",
          type: "out",
          status: normalizedStatus,
          rawStatus: p.status,
          reference: p.reference || `PAY_${String(p._id).slice(-6)}`,
        };
      });
    const allTransactions = [
      ...formattedVenueTransactions,
      ...formattedTicketTransactions,
      ...refundTransactions,
      ...manualOpeningTransactions,
      ...operationsTransactions,
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 30);

    // No withdrawable wallet ledger exists; earnings are not a bank balance.
    const availableBalance = null;

    res.status(200).json({
      success: true,
      data: {
        balance: {
          available: availableBalance,
          totalEarnings,
          pendingPayouts,
          successfulPayouts: naira?.confirmedPayouts || 0,
          directCollections: naira?.directCollections || 0,
          outstandingDirect: naira?.outstandingDirect || 0,
          thisMonthEarnings,
          thisWeekEarnings,
          todayEarnings,
        },
        venueFinance,
        venueMoneyByCurrency: venueMoneyData.currencies,
        venueMoneyBreakdown: venueMoneyData.breakdown,
        reportingBasis: "All amounts shown are your net organiser earnings (Munasaba platform fees excluded), adjusted for recorded refunds.",
        breakdown: {
          ticketRevenue: ticketData.totalRevenue || 0,
          ticketSalesCount: ticketData.completedTicketsCount || 0,
          venueRevenue: venueData.totalRevenue || 0,
          venueBookingsCount: venueData.completedBookingsCount || 0,
        },
        weeklyTrends,
        transactions: allTransactions,
        payouts: [...payoutHistory, ...refundTransactions].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
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
    const PlatformFees = require("../../models/management/platformFees.schema");
    const fees = await PlatformFees.findOne({ key: "platform_fees" }).lean();
    const platformFeePercent = Number(fees?.eventCenterCommission ?? fees?.eventCommission ?? 10);

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
    try {
      const { syncUserEvents } = require("./event.controller");
      const { syncUserEventCenters } = require("./eventCenter.controller");
      await Promise.allSettled([
        syncUserEvents(userId),
        syncUserEventCenters(userId),
      ]);
    } catch (syncErr) {
      console.error("[SETUP SUBACCOUNT SYNC ERROR]", syncErr);
    }

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
    try {
      const { syncUserEvents } = require("./event.controller");
      const { syncUserEventCenters } = require("./eventCenter.controller");
      await Promise.allSettled([
        syncUserEvents(userId),
        syncUserEventCenters(userId),
      ]);
    } catch (syncErr) {
      console.error("[REMOVE SUBACCOUNT SYNC ERROR]", syncErr);
    }

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
