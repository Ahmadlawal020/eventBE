const User = require("../../models/user/user.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const Notification = require("../../models/user/notification.schema");
const CoHostInvitation = require("../../models/user/coHostInvitation.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");

/**
 * 📧 Check if a user exists by email (for Staff)
 */
const checkUserByEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("firstName surname email profilePicture");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      message: "User found",
      data: user,
    });
  } catch (error) {
    console.error("[CHECK USER BY EMAIL] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📩 Invite a Staff Member
 */
const inviteStaff = async (req, res) => {
  try {
    const { staffEmail, listings, permissions } = req.body;
    const organiserId = req.user.id;

    if (!staffEmail || !listings || !permissions) {
      return res.status(400).json({
        success: false,
        message: "Staff email, listings, and permissions are required",
      });
    }

    // 1. Resolve staff user if they already exist
    const staffUser = await User.findOne({ email: staffEmail.toLowerCase() });

    // 2. Prevent co-hosts from being invited as staff for the same listing

    for (const item of listings) {
      // A. Securely validate that the inviting user is either the listing Owner or a Co-Host with MANAGE_STAFF permission
      let listingObj;
      if (item.listingType === "Event") {
        listingObj = await Event.findById(item.listingId).select("createdBy coHosts staff");
      } else {
        listingObj = await EventCenter.findById(item.listingId).select("createdBy coHosts staff");
      }

      if (!listingObj) {
        return res.status(404).json({
          success: false,
          message: `Listing not found: ${item.listingId}`,
        });
      }

      const isOwner = listingObj.createdBy && listingObj.createdBy.toString() === organiserId;

      if (!isOwner) {
        // If not the owner, verify they are an authorized Co-Host with MANAGE_STAFF permission
        const acceptedCoHostInvite = await CoHostInvitation.findOne({
          "listings.listingId": item.listingId,
          coHost: organiserId,
          status: "ACCEPTED",
          permissions: { $in: ["MANAGE_STAFF", "ALL_ACCESS"] }
        });

        if (!acceptedCoHostInvite) {
          return res.status(403).json({
            success: false,
            message: `Authorization failed: You do not have permission to manage staff for listing ${item.listingId}`,
          });
        }
      }

      // B. Check for any PENDING or ACCEPTED Co-Host invitations to prevent inviting co-hosts as staff
      const existingCoHostInvite = await CoHostInvitation.findOne({
        coHostEmail: staffEmail.toLowerCase(),
        "listings.listingId": item.listingId,
        status: { $in: ["PENDING", "ACCEPTED"] },
      });

      if (existingCoHostInvite) {
        return res.status(400).json({
          success: false,
          message: `User is already invited or accepted as a co-host for this listing (${item.listingId}). They cannot be invited as staff.`,
        });
      }

      // C. Check for existing PENDING or ACCEPTED Staff invitations for this listing
      const existingStaffInvite = await StaffInvitation.findOne({
        staffEmail: staffEmail.toLowerCase(),
        "listings.listingId": item.listingId,
        status: { $in: ["PENDING", "ACCEPTED"] },
      });

      if (existingStaffInvite) {
        return res.status(400).json({
          success: false,
          message: `User already has a pending or accepted staff invitation for this listing.`,
        });
      }

      // D. If user exists, check direct co-host/staff inclusion in the listing
      if (staffUser) {
        if (listingObj.coHosts && listingObj.coHosts.some(id => id.equals(staffUser._id))) {
          return res.status(400).json({
            success: false,
            message: "User is already a co-host for this listing. They cannot be invited as staff.",
          });
        }
        if (listingObj.staff && listingObj.staff.some(id => id.equals(staffUser._id))) {
          return res.status(400).json({
            success: false,
            message: "User is already a staff member for this listing.",
          });
        }
      }
    }

    // Create the invitation
    const invitation = await StaffInvitation.create({
      organiser: organiserId,
      staffEmail: staffEmail.toLowerCase(),
      staff: staffUser ? staffUser._id : null,
      listings,
      permissions,
      status: "PENDING",
    });

    if (staffUser) {
      await Notification.create({
        recipient: staffUser._id,
        sender: organiserId,
        type: "STAFF_INVITATION",
        title: "New Staff Invitation",
        message: "You have been invited to be a staff member for one or more listings.",
        referenceId: invitation._id,
      });
    }

    res.status(201).json({
      success: true,
      message: "Staff invitation sent successfully",
      data: invitation,
    });
  } catch (error) {
    console.error("[INVITE STAFF] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📜 Get Staff Invitations (for the Organiser)
 */
const getMyStaffInvitations = async (req, res) => {
  try {
    const organiserId = req.user.id;

    // Fetch all events and centers owned or co-hosted by the user
    const [events, centers] = await Promise.all([
      Event.find({ $or: [{ createdBy: organiserId }, { coHosts: organiserId }] }).select("_id"),
      EventCenter.find({ $or: [{ createdBy: organiserId }, { coHosts: organiserId }] }).select("_id"),
    ]);

    const listingIds = [
      ...events.map(e => e._id),
      ...centers.map(c => c._id)
    ];

    // Find all invitations matching either being the creator OR matching any of the user's listings
    const invitations = await StaffInvitation.find({
      $or: [
        { organiser: organiserId },
        { "listings.listingId": { $in: listingIds } }
      ]
    })
      .populate("staff", "firstName surname email profilePicture")
      .populate("listings.listingId", "title venueName images type")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("[GET MY STAFF INVITATIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📩 Accept or Decline Staff Invitation
 */
const respondToInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // "ACCEPTED" or "DECLINED"
    const userId = req.user.id;

    if (!["ACCEPTED", "DECLINED"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }

    const user = await User.findById(userId).select("email roles");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 🚀 Ensure staff field is linked to user ID if it was sent by email before they registered
    await StaffInvitation.updateOne(
      { _id: id, staffEmail: user.email.toLowerCase(), staff: null },
      { $set: { staff: userId } }
    );

    const invitation = await StaffInvitation.findOneAndUpdate(
      { _id: id, staff: userId, status: "PENDING" },
      { status: action },
      { new: true }
    );

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Invitation not found or already processed" });
    }

    // 🚀 If accepted, add staff to the actual listings
    if (action === "ACCEPTED") {
      const Event = require("../../models/user/event.schema");
      const EventCenter = require("../../models/user/eventCenter.schema");

      for (const item of invitation.listings) {
        if (item.listingType === "Event") {
          await Event.findByIdAndUpdate(item.listingId, {
            $addToSet: { staff: userId },
          });
        } else if (item.listingType === "EventCenter") {
          await EventCenter.findByIdAndUpdate(item.listingId, {
            $addToSet: { staff: userId },
          });
        }
      }
      
      // Add staff role to user if not already present
      if (!user.roles.includes("staff")) {
        user.roles.push("staff");
        await user.save();
      }
    }

    res.json({
      success: true,
      message: `Invitation ${action.toLowerCase()}`,
      data: invitation,
    });
  } catch (error) {
    console.error("[RESPOND INVITATION] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🗑️ Remove a Staff Member from a listing
 */
const removeStaff = async (req, res) => {
  try {
    const { listingId, listingType, staffId } = req.body;
    const organiserId = req.user.id;

    const CoHostInvitation = require("../../models/user/coHostInvitation.schema");
    const Event = require("../../models/user/event.schema");
    const EventCenter = require("../../models/user/eventCenter.schema");

    let listing;
    if (listingType === "Event") {
      listing = await Event.findById(listingId);
    } else {
      listing = await EventCenter.findById(listingId);
    }

    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    const isOwner = listing.createdBy && listing.createdBy.toString() === organiserId;

    if (!isOwner) {
      // Check if they are a co-host with MANAGE_STAFF permission
      const acceptedCoHostInvite = await CoHostInvitation.findOne({
        "listings.listingId": listingId,
        coHost: organiserId,
        status: "ACCEPTED",
        permissions: { $in: ["MANAGE_STAFF", "ALL_ACCESS"] }
      });

      if (!acceptedCoHostInvite) {
        return res.status(403).json({ success: false, message: "Not authorized to manage staff for this listing" });
      }
    }

    // Remove from listing
    if (listingType === "Event") {
      await Event.findByIdAndUpdate(listingId, { $pull: { staff: staffId } });
    } else {
      await EventCenter.findByIdAndUpdate(listingId, { $pull: { staff: staffId } });
    }

    // Delete the corresponding staff invitation
    await StaffInvitation.findOneAndDelete({
      staff: staffId,
      "listings.listingId": listingId
    });

    res.json({
      success: true,
      message: "Staff member removed successfully",
    });
  } catch (error) {
    console.error("[REMOVE STAFF] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📜 Get Received Staff Invitations (for the Staff member)
 */
const getReceivedStaffInvitations = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("email");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 🚀 Proactively bind any pending invitations sent to this user's email before registration
    await StaffInvitation.updateMany(
      { staffEmail: user.email.toLowerCase(), staff: null },
      { $set: { staff: userId } }
    );

    const invitations = await StaffInvitation.find({ staff: userId })
      .populate("organiser", "firstName surname email profilePicture")
      .populate("listings.listingId", "title venueName images type")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("[GET RECEIVED STAFF INVITATIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🔍 Get Staff Invitation By ID
 */
const getStaffInvitationById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const user = await User.findById(userId).select("email");

    if (user) {
      // 🚀 Proactively bind if null
      await StaffInvitation.updateOne(
        { _id: id, staffEmail: user.email.toLowerCase(), staff: null },
        { $set: { staff: userId } }
      );
    }

    const invitation = await StaffInvitation.findById(id)
      .populate("organiser", "firstName surname email profilePicture")
      .populate("staff", "firstName surname email profilePicture")
      .populate("listings.listingId", "title venueName images type");

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Invitation not found" });
    }

    res.json({
      success: true,
      data: invitation,
    });
  } catch (error) {
    console.error("[GET STAFF INVITATION BY ID] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * ❌ Cancel Staff Invitation (by Organiser)
 */
const cancelInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    const organiserId = req.user.id;

    const invitation = await StaffInvitation.findOneAndDelete({
      _id: id,
      organiser: organiserId,
      status: "PENDING",
    });

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Invitation not found or cannot be cancelled" });
    }

    res.json({
      success: true,
      message: "Invitation cancelled successfully",
    });
  } catch (error) {
    console.error("[CANCEL INVITATION] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📊 Get Staff Dashboard Statistics
 */
const getStaffDashboardStats = async (req, res) => {
  try {
    const organiserId = req.user.id;
    const Event = require("../../models/user/event.schema");
    const EventCenter = require("../../models/user/eventCenter.schema");

    // Get all events and event centers owned by this organiser
    const [events, eventCenters] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("staff coHosts"),
      EventCenter.find({ createdBy: organiserId }).select("staff coHosts"),
    ]);

    // Extract unique staff IDs and co-hosts to exclude them
    const staffIds = new Set();
    const coHostIds = new Set();

    events.forEach((e) => {
      e.staff.forEach((id) => staffIds.add(id.toString()));
      if (e.coHosts) e.coHosts.forEach((id) => coHostIds.add(id.toString()));
    });
    eventCenters.forEach((ec) => {
      ec.staff.forEach((id) => staffIds.add(id.toString()));
      if (ec.coHosts) ec.coHosts.forEach((id) => coHostIds.add(id.toString()));
    });

    // Remove any overlapping co-host IDs from the staff count
    coHostIds.forEach((id) => staffIds.delete(id));

    const totalStaffCount = staffIds.size;

    // Get active staff count (where user is active)
    const activeStaffCount = await User.countDocuments({
      _id: { $in: Array.from(staffIds) },
      isActive: true,
    });

    // Get pending invitations
    const pendingInvitationsCount = await StaffInvitation.countDocuments({
      organiser: organiserId,
      status: "PENDING",
    });

    res.json({
      success: true,
      data: {
        totalStaff: totalStaffCount,
        onDuty: activeStaffCount,
        pending: pendingInvitationsCount,
      },
    });
  } catch (error) {
    console.error("[GET STAFF DASHBOARD STATS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 👥 Get All Staff Members for an Organiser
 */
const getAllStaff = async (req, res) => {
  try {
    const organiserId = req.user.id;
    const Event = require("../../models/user/event.schema");
    const EventCenter = require("../../models/user/eventCenter.schema");

    const [events, eventCenters] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("staff coHosts"),
      EventCenter.find({ createdBy: organiserId }).select("staff coHosts"),
    ]);

    const staffIds = new Set();
    const coHostIds = new Set();

    events.forEach((e) => {
      e.staff.forEach((id) => staffIds.add(id.toString()));
      if (e.coHosts) e.coHosts.forEach((id) => coHostIds.add(id.toString()));
    });
    eventCenters.forEach((ec) => {
      ec.staff.forEach((id) => staffIds.add(id.toString()));
      if (ec.coHosts) ec.coHosts.forEach((id) => coHostIds.add(id.toString()));
    });

    // Strictly separate co-hosts from the staff list representation
    coHostIds.forEach((id) => staffIds.delete(id));

    const staff = await User.find({ _id: { $in: Array.from(staffIds) } }).select(
      "firstName surname email profilePicture isActive roles"
    );

    res.json({
      success: true,
      data: staff,
    });
  } catch (error) {
    console.error("[GET ALL STAFF] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  checkUserByEmail,
  inviteStaff,
  getMyStaffInvitations,
  getReceivedStaffInvitations,
  getStaffInvitationById,
  respondToInvitation,
  cancelInvitation,
  removeStaff,
  getStaffDashboardStats,
  getAllStaff,
};
