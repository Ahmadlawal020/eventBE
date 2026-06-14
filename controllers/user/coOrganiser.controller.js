const User = require("../../models/user/user.schema");
const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
const Notification = require("../../models/user/notification.schema");

/**
 * 📧 Check if a user exists by email
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
 * 📩 Invite a Co-Host
 */
const inviteCoHost = async (req, res) => {
  try {
    const { coHostEmail, listings, permissions } = req.body;
    const hostId = req.user.id;

    if (!coHostEmail || !listings || !permissions) {
      return res.status(400).json({
        success: false,
        message: "Co-organiser email, listings, and permissions are required",
      });
    }

    // 1. Prevent duplicate active pending invitations for the same co-host
    const existingInvitation = await CoHostInvitation.findOne({
      host: hostId,
      coHostEmail: coHostEmail.toLowerCase(),
      status: "PENDING",
    });

    if (existingInvitation) {
      return res.status(400).json({
        success: false,
        message: "An active pending invitation already exists for this co-organiser email.",
      });
    }

    // 2. Securely validate listing ownership (prevent authorization spoofing)
    const Event = require("../../models/user/event.schema");
    const EventCenter = require("../../models/user/eventCenter.schema");

    for (const item of listings) {
      let listing;
      if (item.listingType === "Event") {
        listing = await Event.findOne({ _id: item.listingId, createdBy: hostId });
      } else if (item.listingType === "EventCenter") {
        listing = await EventCenter.findOne({ _id: item.listingId, createdBy: hostId });
      }
      if (!listing) {
        return res.status(403).json({
          success: false,
          message: `Authorization failed: You do not own listing ${item.listingId}`,
        });
      }
    }

    // Check if co-host exists in the system
    const coHost = await User.findOne({ email: coHostEmail.toLowerCase() });

    // Create the invitation
    const invitation = await CoHostInvitation.create({
      host: hostId,
      coHostEmail: coHostEmail.toLowerCase(),
      coHost: coHost ? coHost._id : null,
      listings,
      permissions,
      status: "PENDING",
    });

    if (coHost) {
      await Notification.create({
        recipient: coHost._id,
        sender: hostId,
        type: "COHOST_INVITATION",
        title: "New Co-organiser Invitation",
        message: "You have been invited to be a co-organiser for one or more listings.",
        referenceId: invitation._id,
      });
    }

    res.status(201).json({
      success: true,
      message: "Co-organiser invitation sent successfully",
      data: invitation,
    });
  } catch (error) {
    console.error("[INVITE CO-HOST] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📜 Get Co-Host Invitations (for the Host)
 */
const getMyCoOrganiserInvitations = async (req, res) => {
  try {
    const hostId = req.user.id;
    const invitations = await CoHostInvitation.find({ host: hostId })
      .populate("coHost", "firstName surname email profilePicture")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("[GET MY CO-HOST INVITATIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📜 Get a specific Co-Host Invitation
 */
const getInvitationById = async (req, res) => {
  try {
    const { id } = req.params;
    const invitation = await CoHostInvitation.findById(id)
      .populate("host", "firstName surname profilePicture")
      .populate("listings.listingId", "title venueName images type");

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Invitation not found" });
    }

    res.json({
      success: true,
      data: invitation,
    });
  } catch (error) {
    console.error("[GET INVITATION] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📩 Accept or Decline Invitation
 */
const respondToInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // "ACCEPTED" or "DECLINED"
    const userId = req.user.id;

    if (!["ACCEPTED", "DECLINED"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }

    const invitation = await CoHostInvitation.findOneAndUpdate(
      { _id: id, coHost: userId, status: "PENDING" },
      { status: action },
      { new: true }
    );

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Invitation not found or already processed" });
    }

    // 🚀 If accepted, add co-host to the actual listings
    if (action === "ACCEPTED") {
      const Event = require("../../models/user/event.schema");
      const EventCenter = require("../../models/user/eventCenter.schema");

      for (const item of invitation.listings) {
        if (item.listingType === "Event") {
          await Event.findByIdAndUpdate(item.listingId, {
            $addToSet: { coHosts: userId },
          });
        } else if (item.listingType === "EventCenter") {
          await EventCenter.findByIdAndUpdate(item.listingId, {
            $addToSet: { coHosts: userId },
          });
        }
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
 * 🗑️ Remove a Co-Host from a listing
 */
const removeCoOrganiser = async (req, res) => {
  try {
    const { listingId, listingType, coHostId } = req.body;
    const hostId = req.user.id;

    if (!listingId || !listingType || !coHostId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

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

    // Authorize: Either the user is the original owner (createdBy === hostId)
    // OR the user is the co-host removing themselves (coHostId === hostId)
    const isOwner = listing.createdBy && listing.createdBy.toString() === hostId;
    const isRemovingSelf = coHostId === hostId;

    if (!isOwner && !isRemovingSelf) {
      return res.status(403).json({ success: false, message: "Not authorized to manage this listing" });
    }

    // If a co-host is removing themselves, require password verification
    if (isRemovingSelf) {
      const User = require("../../models/user/user.schema");
      const user = await User.findById(hostId).select("password authProvider");
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const isGoogleOnly = user.authProvider === "google" && !user.password;

      if (!isGoogleOnly) {
        const { password } = req.body;
        if (!password) {
          return res.status(400).json({ success: false, message: "Password is required to leave the listing" });
        }

        if (user.password) {
          const bcrypt = require("bcrypt");
          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) {
            return res.status(401).json({ success: false, message: "Incorrect password" });
          }
        }
      }
    }

    // Remove from listing
    if (listingType === "Event") {
      await Event.findByIdAndUpdate(listingId, { $pull: { coHosts: coHostId } });
    } else {
      await EventCenter.findByIdAndUpdate(listingId, { $pull: { coHosts: coHostId } });
    }

    // Update invitation status: remove listing from invitation, set to DECLINED only if no listings left
    const invitation = await CoHostInvitation.findOne({
      coHost: coHostId,
      "listings.listingId": listingId,
      status: "ACCEPTED"
    });

    if (invitation) {
      if (invitation.listings.length > 1) {
        invitation.listings = invitation.listings.filter(
          item => item.listingId.toString() !== listingId.toString()
        );
        await invitation.save();
      } else {
        invitation.status = "DECLINED";
        await invitation.save();
      }
    }

    res.json({
      success: true,
      message: isRemovingSelf ? "You have successfully left the listing" : "Co-organiser removed successfully",
    });
  } catch (error) {
    console.error("[REMOVE CO-HOST] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🛠️ Update Co-Host Permissions
 */
const updateCoOrganiserPermissions = async (req, res) => {
  try {
    const { listingId, coHostId, permissions } = req.body;
    const hostId = req.user.id;

    if (!listingId || !coHostId || !permissions) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Find the active invitation for this co-host and listing
    const invitation = await CoHostInvitation.findOneAndUpdate(
      { 
        host: hostId, 
        coHost: coHostId, 
        "listings.listingId": listingId,
        status: "ACCEPTED" 
      },
      { permissions },
      { new: true }
    );

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Active invitation not found" });
    }

    res.json({
      success: true,
      message: "Permissions updated successfully",
      data: invitation,
    });
  } catch (error) {
    console.error("[UPDATE PERMISSIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🗑️ Cancel a pending invitation (by the Host)
 */
const cancelInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    const hostId = req.user.id;

    const invitation = await CoHostInvitation.findOneAndDelete({
      _id: id,
      host: hostId,
      status: "PENDING"
    });

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Pending invitation not found" });
    }

    // Proactively clean up notification reference
    await Notification.deleteMany({ referenceId: id });

    res.json({
      success: true,
      message: "Invitation cancelled successfully"
    });
  } catch (error) {
    console.error("[CANCEL INVITATION] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 📜 Get Received Co-Host Invitations (for the Co-Host)
 */
const getReceivedInvitations = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("email");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 🚀 Proactively bind invitations that were sent to this user's email before they registered
    await CoHostInvitation.updateMany(
      { coHostEmail: user.email.toLowerCase(), coHost: null },
      { $set: { coHost: userId } }
    );

    const invitations = await CoHostInvitation.find({ coHost: userId })
      .populate("host", "firstName surname email profilePicture")
      .populate("listings.listingId", "title venueName images type")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("[GET RECEIVED INVITATIONS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  checkUserByEmail,
  inviteCoHost,
  getMyCoOrganiserInvitations,
  getInvitationById,
  respondToInvitation,
  removeCoOrganiser,
  updateCoOrganiserPermissions,
  getReceivedInvitations,
  cancelInvitation,
};
