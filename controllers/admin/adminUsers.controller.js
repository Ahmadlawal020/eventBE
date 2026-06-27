const User = require("../../models/user/user.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const EventBooking = require("../../models/user/eventBooking.schema");
const EventCenterBooking = require("../../models/user/eventCenterBooking.schema");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getUsers = async (req, res) => {
  try {
    const { search, role, status, page = 1, limit = 20 } = req.query;
    const query = {};

    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { firstName: new RegExp(safeSearch, "i") },
        { surname: new RegExp(safeSearch, "i") },
        { email: new RegExp(safeSearch, "i") },
        { phoneNumber: new RegExp(safeSearch, "i") },
      ];
    }

    if (role) query.roles = role;
    if (status === "active") query.isActive = true;
    if (status === "suspended") query.isActive = false;

    const skip = (Number(page) - 1) * Number(limit);
    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -refreshToken")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error("[ADMIN GET USERS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching users" });
  }
};

const getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const [user, events, eventCenters, eventBookings, venueBookings] = await Promise.all([
      User.findById(id).select("-password -refreshToken").lean(),
      Event.find({
        $or: [
          { createdBy: id },
          { coOrganisers: id },
          { staff: id }
        ]
      })
        .select("title status schedule performance createdAt coOrganisers staff createdBy")
        .populate("coOrganisers", "firstName surname email")
        .populate("staff", "firstName surname email")
        .populate("createdBy", "firstName surname email")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      EventCenter.find({
        $or: [
          { createdBy: id },
          { coOrganisers: id },
          { staff: id }
        ]
      })
        .select("venueName status performance createdAt coOrganisers staff createdBy")
        .populate("coOrganisers", "firstName surname email")
        .populate("staff", "firstName surname email")
        .populate("createdBy", "firstName surname email")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      EventBooking.find({ buyer: id }).select("eventId totalAmount currency paymentStatus status createdAt").populate("eventId", "title").sort({ createdAt: -1 }).limit(10).lean(),
      EventCenterBooking.find({ buyer: id }).select("eventCenter totalPrice paymentStatus status createdAt").populate("eventCenter", "venueName").sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      data: {
        user,
        events,
        eventCenters,
        eventBookings,
        venueBookings,
      },
    });
  } catch (error) {
    console.error("[ADMIN GET USER DETAILS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error fetching user details" });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, reason } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isActive boolean is required" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const previousValue = { isActive: user.isActive };
    user.isActive = isActive;
    await user.save();

    await recordAdminAction({
      req,
      action: isActive ? "USER_REACTIVATED" : "USER_SUSPENDED",
      targetType: "User",
      targetId: user._id,
      previousValue,
      newValue: { isActive },
      metadata: { reason },
    });

    res.status(200).json({
      success: true,
      message: isActive ? "User reactivated" : "User suspended",
      data: { user: { id: user._id, isActive: user.isActive } },
    });
  } catch (error) {
    console.error("[ADMIN UPDATE USER STATUS ERROR]", error);
    res.status(500).json({ success: false, message: "Server error updating user status" });
  }
};

const updateUserVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { isEmailVerified, isPhoneVerified, isIdentityVerified } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const previousValue = {
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      isIdentityVerified: user.isIdentityVerified,
    };

    if (typeof isEmailVerified === "boolean") {
      user.isEmailVerified = isEmailVerified;
      user.emailVerifiedAt = isEmailVerified ? new Date() : null;
    }
    if (typeof isPhoneVerified === "boolean") {
      user.isPhoneVerified = isPhoneVerified;
      user.phoneVerifiedAt = isPhoneVerified ? new Date() : null;
    }
    if (typeof isIdentityVerified === "boolean") {
      user.isIdentityVerified = isIdentityVerified;
    }

    await user.save();

    await recordAdminAction({
      req,
      action: "USER_VERIFICATION_UPDATED",
      targetType: "User",
      targetId: user._id,
      previousValue,
      newValue: {
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        isIdentityVerified: user.isIdentityVerified,
      },
    });

    res.status(200).json({ success: true, message: "Verification updated" });
  } catch (error) {
    console.error("[ADMIN UPDATE USER VERIFICATION ERROR]", error);
    res.status(500).json({ success: false, message: "Server error updating verification" });
  }
};

module.exports = {
  getUsers,
  getUserDetails,
  updateUserStatus,
  updateUserVerification,
};
