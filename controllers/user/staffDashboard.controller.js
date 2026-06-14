const User = require("../../models/user/user.schema");
const UserEventTicket = require("../../models/user/userEventTicket.schema");
const StaffActivity = require("../../models/user/staffActivity.schema");
const StaffInvitation = require("../../models/user/staffInvitation.schema");
const Event = require("../../models/user/event.schema");
const EventCenter = require("../../models/user/eventCenter.schema");
const mongoose = require("mongoose");

/**
 * 📊 Get Aggregated Staff Statistics for Organiser Dashboard
 */
exports.getOrganiserStaffStats = async (req, res) => {
  try {
    const organiserId = req.user.id;

    // 1. Get all staff associated with organiser's listings
    const [events, centers] = await Promise.all([
      Event.find({ createdBy: organiserId }).select("staff"),
      EventCenter.find({ createdBy: organiserId }).select("staff"),
    ]);

    const staffIds = new Set();
    events.forEach(e => e.staff.forEach(id => staffIds.add(id.toString())));
    centers.forEach(c => c.staff.forEach(id => staffIds.add(id.toString())));

    const totalStaffCount = staffIds.size;

    // 2. Get active staff count (last 24h activity)
    const activeStaffCount = await StaffActivity.distinct("staff", {
      organiser: organiserId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).then(ids => ids.length);

    // 3. Get pending invitations
    const pendingInvites = await StaffInvitation.countDocuments({
      organiser: organiserId,
      status: "PENDING"
    });

    // 4. Get total scans & check-ins for all organiser events
    const ticketStats = await UserEventTicket.aggregate([
      { 
        $match: { 
          eventId: { $in: events.map(e => e._id) },
          "checkIn.isCheckedIn": true 
        } 
      },
      {
        $group: {
          _id: null,
          totalCheckIns: { $sum: 1 },
          qrScans: { $sum: { $cond: [{ $eq: ["$checkIn.method", "QR"] }, 1, 0] } },
          manualCheckIns: { $sum: { $cond: [{ $eq: ["$checkIn.method", "MANUAL"] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        totalStaff: totalStaffCount,
        activeStaff: activeStaffCount,
        pendingInvitations: pendingInvites,
        performance: ticketStats[0] || { totalCheckIns: 0, qrScans: 0, manualCheckIns: 0 }
      }
    });
  } catch (error) {
    console.error("[GET ORGANISER STAFF STATS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 👤 Get Detailed Staff Profile & Activity
 */
exports.getStaffDetailedProfile = async (req, res) => {
  try {
    const { staffId } = req.params;
    const organiserId = req.user.id;

    // 1. Basic User Info
    const staffUser = await User.findById(staffId).select("firstName surname email profilePicture isActive createdAt");
    if (!staffUser) {
      return res.status(404).json({ success: false, message: "Staff member not found" });
    }

    // 2. Fetch specific stats for this staff member (Scans & Check-ins)
    const performance = await UserEventTicket.aggregate([
      {
        $match: {
          $or: [
            { "checkIn.checkedInBy": new mongoose.Types.ObjectId(staffId) },
            { redeemedBy: new mongoose.Types.ObjectId(staffId) }
          ]
        }
      },
      {
        $group: {
          _id: null,
          ticketScans: { $sum: { $cond: [{ $eq: ["$checkIn.method", "QR"] }, 1, 0] } },
          manualCheckIns: { $sum: { $cond: [{ $eq: ["$checkIn.method", "MANUAL"] }, 1, 0] } },
        }
      }
    ]);

    // Fetch all events and centers owned or co-hosted by the user
    const [events, centers] = await Promise.all([
      Event.find({ $or: [{ createdBy: organiserId }, { coHosts: organiserId }] }).select("_id"),
      EventCenter.find({ $or: [{ createdBy: organiserId }, { coHosts: organiserId }] }).select("_id"),
    ]);

    const listingIds = [
      ...events.map(e => e._id),
      ...centers.map(c => c._id)
    ];

    // Find the accepted staff invitation that has at least one listing managed by the user
    const invitation = await StaffInvitation.findOne({
      staff: staffId,
      status: "ACCEPTED",
      "listings.listingId": { $in: listingIds }
    }).select("permissions listings");

    if (!invitation) {
      return res.status(403).json({ success: false, message: "Authorization failed: You do not manage this staff member." });
    }

    // 3. Fetch Recent Activities
    const activities = await StaffActivity.find({ 
      staff: staffId,
      $or: [
        { organiser: organiserId },
        { organiser: invitation.organiser }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(20);

    res.json({
      success: true,
      data: {
        profile: staffUser,
        stats: performance[0] || { ticketScans: 0, manualCheckIns: 0 },
        activities,
        access: invitation || { permissions: [], listings: [] }
      }
    });
  } catch (error) {
    console.error("[GET STAFF DETAILED PROFILE] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🛠️ Update Staff Roles & Permissions
 */
exports.updateStaffAccess = async (req, res) => {
  try {
    const { staffId } = req.params;
    const { permissions, listings } = req.body;
    const organiserId = req.user.id;

    // Verify user has authority (owner or co-host with MANAGE_STAFF/ALL_ACCESS) for all requested listings
    const CoHostInvitation = require("../../models/user/coOrganiserInvitation.schema");
    
    for (const item of listings) {
      let listingObj;
      if (item.listingType === "Event") {
        listingObj = await Event.findById(item.listingId).select("createdBy");
      } else {
        listingObj = await EventCenter.findById(item.listingId).select("createdBy");
      }

      if (!listingObj) {
        return res.status(404).json({ success: false, message: `Listing not found: ${item.listingId}` });
      }

      const isOwner = listingObj.createdBy && listingObj.createdBy.toString() === organiserId;

      if (!isOwner) {
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
    }

    const invitation = await StaffInvitation.findOneAndUpdate(
      { 
        staff: staffId, 
        status: "ACCEPTED",
        "listings.listingId": listings[0].listingId 
      },
      { permissions, listings },
      { new: true }
    );

    if (!invitation) {
      return res.status(404).json({ success: false, message: "Staff relationship not found" });
    }

    // Log the permission change
    await StaffActivity.create({
      staff: staffId,
      organiser: organiserId,
      action: "PERMISSION_CHANGE",
      title: "Permissions Updated",
      description: `Organiser updated permissions for staff`,
      metadata: { updatedBy: organiserId }
    });

    res.json({
      success: true,
      message: "Permissions updated successfully",
      data: invitation
    });
  } catch (error) {
    console.error("[UPDATE STAFF ACCESS] ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * 🚀 Log Staff Activity (Internal helper or endpoint)
 */
exports.logActivity = async (staffId, organiserId, action, title, description, metadata = {}) => {
  try {
    await StaffActivity.create({
      staff: staffId,
      organiser: organiserId,
      action,
      title,
      description,
      metadata
    });
  } catch (error) {
    console.error("[LOG STAFF ACTIVITY] ERROR:", error);
  }
};
