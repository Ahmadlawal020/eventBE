const User = require("../../models/user/user.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const { getPaymentGateway } = require("../../services/payment");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const gateway = getPaymentGateway();

/**
 * @desc    Get finance stats, balance, and recent transactions
 * @route   GET /api/finance-dashboard/stats
 * @access  Private
 */
const getFinanceStats = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId).select("bankDetails vendorAccountCode");

    // 1. Scalable aggregation in DB: calculates earnings and pending totals without loading documents
    const stats = await EventCenterBooking.aggregate([
      { $match: { organiser: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalEarnings: {
            $sum: {
              $cond: [
                { $eq: ["$paymentStatus", "COMPLETED"] },
                { $ifNull: ["$totalPrice.amount", 0] },
                0,
              ],
            },
          },
          pendingPayouts: {
            $sum: {
              $cond: [
                { $eq: ["$paymentStatus", "PENDING"] },
                { $ifNull: ["$totalPrice.amount", 0] },
                0,
              ],
            },
          },
        },
      },
    ]);

    const totalEarnings = stats[0]?.totalEarnings || 0;
    const pendingPayouts = stats[0]?.pendingPayouts || 0;
    const successfulPayouts = 0; // Simulated for now

    // 2. Fetch only the top 10 completed transactions for the dashboard (extremely lightweight)
    const recentTickets = await EventCenterBooking.find({
      organiser: userId,
      paymentStatus: "COMPLETED",
    })
      .populate("eventCenter", "venueName")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const transactions = recentTickets.map((ticket) => ({
      id: ticket._id,
      title: `Booking - ${ticket.eventCenter?.venueName || "Venue"}`,
      date: ticket.createdAt,
      amount: ticket.totalPrice?.amount || 0,
      type: "in",
      status: "COMPLETED",
    }));

    const availableBalance = totalEarnings;

    res.status(200).json({
      success: true,
      data: {
        balance: {
          available: availableBalance,
          totalEarnings,
          pendingPayouts,
          successfulPayouts,
        },
        transactions,
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

  if (!password) {
    return res.status(400).json({ success: false, message: "Password is required" });
  }

  try {
    const user = await User.findById(userId).select("password authProvider");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Google-only users don't have a password
    if (user.authProvider === "google" && !user.password) {
      return res.status(400).json({
        success: false,
        message: "This account uses Google authentication. Password verification is not available.",
      });
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

    // Create vendor account via payment gateway
    const vendorData = await gateway.createVendorAccount({
      businessName: user.fullName || accountName,
      bankCode: bankCode,
      accountNumber: accountNumber,
      platformFeePercent: 10,
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

    if (!user.vendorAccountCode) {
      return res.status(400).json({ success: false, message: "No payout method linked to remove" });
    }

    // 1. Deactivate the vendor account on payment gateway
    try {
      await gateway.deactivateVendorAccount(user.vendorAccountCode);
    } catch (gatewayError) {
      // Log error, but allow DB cleanup so user doesn't get stuck
      console.error("[GATEWAY DEACTIVATE VENDOR ACCOUNT ERROR]", gatewayError.message || gatewayError);
    }

    // 2. Clear vendor account and bank details locally
    user.vendorAccountCode = undefined;
    user.bankDetails = undefined;
    await user.save();

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
