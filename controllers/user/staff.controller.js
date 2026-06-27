const User = require("../../models/user/user.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const Notification = require("../../models/user/notification.schema");
const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");
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

    // 2. Prevent co-organisers from being invited as staff for the same listing

    for (const item of listings) {
      // A. Securely validate that the inviting user is either the listing Owner or a Co-Organiser with MANAGE_STAFF permission
      let listingObj;
      if (item.listingType === "Event") {
        listingObj = await Event.findById(item.listingId).select("createdBy coOrganisers staff");
      } else {
        listingObj = await EventCenter.findById(item.listingId).select("createdBy coOrganisers staff");
      }

      if (!listingObj) {
        return res.status(404).json({
          success: false,
          message: `Listing not found: ${item.listingId}`,
        });
      }

      const isOwner = listingObj.createdBy && listingObj.createdBy.toString() === organiserId;

      if (!isOwner) {
        // If not the owner, verify they are an authorized Co-Organiser with MANAGE_STAFF permission
        const acceptedCoOrganiserInvite = await CoOrganiserInvitation.findOne({
          "listings.listingId": item.listingId,
          coOrganiser: organiserId,
          status: "ACCEPTED",
          permissions: { $in: ["MANAGE_STAFF", "ALL_ACCESS"] }
        });

        if (!acceptedCoOrganiserInvite) {
          return res.status(403).json({
            success: false,
            message: `Authorization failed: You do not have permission to manage staff for listing ${item.listingId}`,
          });
        }
      }

      // B. Check for any PENDING or ACCEPTED Co-Organiser invitations to prevent inviting co-organisers as staff
      const existingCoOrganiserInvite = await CoOrganiserInvitation.findOne({
        coOrganiserEmail: staffEmail.toLowerCase(),
        "listings.listingId": item.listingId,
        status: { $in: ["PENDING", "ACCEPTED"] },
      });

      if (existingCoOrganiserInvite) {
        return res.status(400).json({
          success: false,
          message: `User is already invited or accepted as a co-organiser for this listing (${item.listingId}). They cannot be invited as staff.`,
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

      // D. If user exists, check direct co-organiser/staff inclusion in the listing
      if (staffUser) {
        if (listingObj.coOrganisers && listingObj.coOrganisers.some(id => id.equals(staffUser._id))) {
          return res.status(400).json({
            success: false,
            message: "User is already a co-organiser for this listing. They cannot be invited as staff.",
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
    const { page = 1, limit = 20 } = req.query;

    // Fetch all events and centers owned or co-organised by the user
    const [events, centers] = await Promise.all([
      Event.find({ $or: [{ createdBy: organiserId }, { coOrganisers: organiserId }] }).select("_id"),
      EventCenter.find({ $or: [{ createdBy: organiserId }, { coOrganisers: organiserId }] }).select("_id"),
    ]);

    const listingIds = [
      ...events.map(e => e._id),
      ...centers.map(c => c._id)
    ];

    const query = {
      $or: [
        { organiser: organiserId },
        { "listings.listingId": { $in: listingIds } }
      ],
      status: { $ne: "LEFT" },
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [invitations, total] = await Promise.all([
      StaffInvitation.find(query)
        .populate("staff", "firstName surname email profilePicture")
        .populate("listings.listingId", "title venueName images type")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      StaffInvitation.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: invitations,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
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
      { _id: id, staff: userId, status: "PENDING", expiresAt: { $gt: new Date() } },
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

const CoOrganiserInvitation = require("../../models/user/coOrganiserInvitation.schema");

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
      const acceptedCoOrganiserInvite = await CoOrganiserInvitation.findOne({
        "listings.listingId": listingId,
        coOrganiser: organiserId,
        status: "ACCEPTED",
        permissions: { $in: ["MANAGE_STAFF", "ALL_ACCESS"] }
      });

      if (!acceptedCoOrganiserInvite) {
        return res.status(403).json({ success: false, message: "Not authorized to manage staff for this listing" });
      }
    }

    // Remove staff from the listing's staff array
    if (listingType === "Event") {
      await Event.findByIdAndUpdate(listingId, { $pull: { staff: staffId } });
    } else {
      await EventCenter.findByIdAndUpdate(listingId, { $pull: { staff: staffId } });
    }

    // Find the invitation containing this listing
    const invitation = await StaffInvitation.findOne({
      staff: staffId,
      "listings.listingId": listingId,
    });

    if (invitation) {
      // Remove only this listing from the invitation
      invitation.listings = invitation.listings.filter(
        (l) => l.listingId.toString() !== listingId
      );

      if (invitation.listings.length === 0) {
        // No listings left — delete the invitation entirely
        await StaffInvitation.findByIdAndDelete(invitation._id);
      } else {
        await invitation.save();
      }

      // Check if the staff member has any other ACCEPTED invitations
      const otherActive = await StaffInvitation.countDocuments({
        staff: staffId,
        status: "ACCEPTED",
      });

      if (otherActive === 0) {
        const user = await User.findById(staffId).select("roles");
        if (user && user.roles.includes("staff")) {
          user.roles = user.roles.filter((r) => r !== "staff");
          await user.save();
        }
      }
    }

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
 * 🚫 Revoke All Access — Remove a staff member from ALL listings for this organiser
 */
const revokeAllAccess = async (req, res) => {
  try {
    const { staffId } = req.params;
    const organiserId = req.user.id;

    // Find all ACCEPTED invitations for this staff member with this organiser
    const invitations = await StaffInvitation.find({
      staff: staffId,
      organiser: organiserId,
      status: "ACCEPTED",
    });

    if (invitations.length === 0) {
      return res.status(404).json({ success: false, message: "No active staff relationship found" });
    }

    // Remove staff from all listings across all invitations
    for (const invitation of invitations) {
      for (const item of invitation.listings) {
        if (item.listingType === "Event") {
          await Event.findByIdAndUpdate(item.listingId, { $pull: { staff: staffId } });
        } else if (item.listingType === "EventCenter") {
          await EventCenter.findByIdAndUpdate(item.listingId, { $pull: { staff: staffId } });
        }
      }
    }

    // Delete all invitations for this staff-organiser pair
    await StaffInvitation.deleteMany({
      staff: staffId,
      organiser: organiserId,
    });

    // Check if the staff member has any other ACCEPTED invitations from other organisers
    const otherActive = await StaffInvitation.countDocuments({
      staff: staffId,
      status: "ACCEPTED",
    });

    if (otherActive === 0) {
      const user = await User.findById(staffId).select("roles");
      if (user && user.roles.includes("staff")) {
        user.roles = user.roles.filter((r) => r !== "staff");
        await user.save();
      }
    }

    res.json({
      success: true,
      message: "All staff access revoked successfully",
    });
  } catch (error) {
    console.error("[REVOKE ALL ACCESS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📜 Get Received Staff Invitations (for the Staff member)
 */
const getReceivedStaffInvitations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const user = await User.findById(userId).select("email");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 🚀 Proactively bind any pending invitations sent to this user's email before registration
    await StaffInvitation.updateMany(
      { staffEmail: user.email.toLowerCase(), staff: null },
      { $set: { staff: userId } }
    );

    const query = { staff: userId, status: { $ne: "LEFT" } };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [invitations, total] = await Promise.all([
      StaffInvitation.find(query)
        .populate("organiser", "firstName surname email profilePicture")
        .populate("listings.listingId", "title venueName images type")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      StaffInvitation.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: invitations,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
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
      Event.find({ createdBy: organiserId }).select("staff coOrganisers"),
      EventCenter.find({ createdBy: organiserId }).select("staff coOrganisers"),
    ]);

    // Extract unique staff IDs and co-organisers to exclude them
    const staffIds = new Set();
    const coOrganiserIds = new Set();

    events.forEach((e) => {
      e.staff.forEach((id) => staffIds.add(id.toString()));
      if (e.coOrganisers) e.coOrganisers.forEach((id) => coOrganiserIds.add(id.toString()));
    });
    eventCenters.forEach((ec) => {
      ec.staff.forEach((id) => staffIds.add(id.toString()));
      if (ec.coOrganisers) ec.coOrganisers.forEach((id) => coOrganiserIds.add(id.toString()));
    });

    // Remove any overlapping co-organiser IDs from the staff count
    coOrganiserIds.forEach((id) => staffIds.delete(id));

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
    const { page = 1, limit = 20 } = req.query;

    const [events, eventCenters] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("staff coOrganisers"),
      EventCenter.find({ createdBy: organiserId }).select("staff coOrganisers"),
    ]);

    const staffIds = new Set();
    const coOrganiserIds = new Set();

    events.forEach((e) => {
      e.staff.forEach((id) => staffIds.add(id.toString()));
      if (e.coOrganisers) e.coOrganisers.forEach((id) => coOrganiserIds.add(id.toString()));
    });
    eventCenters.forEach((ec) => {
      ec.staff.forEach((id) => staffIds.add(id.toString()));
      if (ec.coOrganisers) ec.coOrganisers.forEach((id) => coOrganiserIds.add(id.toString()));
    });

    coOrganiserIds.forEach((id) => staffIds.delete(id));

    const query = { _id: { $in: Array.from(staffIds) } };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [staff, total] = await Promise.all([
      User.find(query)
        .select("firstName surname email profilePicture isActive roles createdAt")
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: staff,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[GET ALL STAFF] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🚪 Leave Staff — Staff member removes themselves
 */
const leaveStaff = async (req, res) => {
  try {
    const { invitationId } = req.params;
    const userId = req.user.id;

    const invitation = await StaffInvitation.findOne({
      _id: invitationId,
      staff: userId,
      status: "ACCEPTED",
    });

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: "Invitation not found or you are not the staff member",
      });
    }

    // Remove the user from every listing in this invitation
    for (const item of invitation.listings) {
      if (item.listingType === "Event") {
        await Event.findByIdAndUpdate(item.listingId, {
          $pull: { staff: userId },
        });
      } else if (item.listingType === "EventCenter") {
        await EventCenter.findByIdAndUpdate(item.listingId, {
          $pull: { staff: userId },
        });
      }
    }

    // Mark invitation as LEFT
    invitation.status = "LEFT";
    await invitation.save();

    // If the user has no other ACCEPTED staff invitations, remove the staff role
    const otherActive = await StaffInvitation.countDocuments({
      staff: userId,
      status: "ACCEPTED",
    });

    if (otherActive === 0) {
      const user = await User.findById(userId).select("roles");
      if (user && user.roles.includes("staff")) {
        user.roles = user.roles.filter((r) => r !== "staff");
        await user.save();
      }
    }

    // Notify the organiser
    await Notification.create({
      recipient: invitation.organiser,
      sender: userId,
      type: "STAFF_INVITATION",
      title: "Staff Member Left",
      message: "A staff member has opted out of their role.",
      referenceId: invitation._id,
    });

    res.json({
      success: true,
      message: "You have successfully left the staff role",
    });
  } catch (error) {
    console.error("[LEAVE STAFF] ERROR:", error);
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
  revokeAllAccess,
  leaveStaff,
  getStaffDashboardStats,
  getAllStaff,
};
