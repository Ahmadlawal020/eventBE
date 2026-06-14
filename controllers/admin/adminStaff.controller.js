const asyncHandler = require("express-async-handler");
const Admin = require("../../models/admin/admin.schema");
const { recordAdminAction } = require("../../services/admin/adminAudit.service");

// Escape search string
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const nodemailer = require("nodemailer");
const crypto = require("crypto");

// Setup transporter for invitations
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: process.env.EMAIL_PORT || 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// @desc Get all staff members (Admins)
// @route GET /api/admin/staff
const getStaffs = asyncHandler(async (req, res) => {
  const { search, role, status, page = 1, limit = 20 } = req.query;
  const query = {};

  if (search) {
    const safeSearch = escapeRegex(search);
    query.$or = [
      { firstName: new RegExp(safeSearch, "i") },
      { surname: new RegExp(safeSearch, "i") },
      { email: new RegExp(safeSearch, "i") },
    ];
  }

  if (role) query.roles = role;
  
  if (status === "active") {
    query.$or = [{ status: "active" }, { status: { $exists: false } }];
  } else if (status === "suspended") {
    query.status = "suspended";
  } else if (status === "pending") {
    query.status = "pending";
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [staffs, total] = await Promise.all([
    Admin.find(query)
      .select("-password -refreshToken")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Admin.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: {
      staffs,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

// @desc Invite a new staff member (creates an admin record)
// @route POST /api/admin/staff/invite
const inviteStaff = asyncHandler(async (req, res) => {
  const {
    firstName,
    surname,
    email,
    roles,
    phoneNumber,
    gender,
    dob,
    department,
    employmentType,
    branch,
  } = req.body;

  if (!firstName || !surname || !email) {
    return res.status(400).json({ success: false, message: "Required fields missing" });
  }

  const existingAdmin = await Admin.findOne({ email: email.toLowerCase() }).exec();
  if (existingAdmin) {
    return res.status(409).json({ success: false, message: "Staff member with this email already exists" });
  }

  const assignedRoles = roles && roles.length > 0 ? roles : ["staff"];
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  const newAdmin = await Admin.create({
    firstName,
    surname,
    email: email.toLowerCase(),
    roles: assignedRoles,
    status: "pending",
    isActive: false,
    inviteToken,
    inviteTokenExpiresAt,
    phoneNumber,
    gender,
    dateOfBirth: dob ? new Date(dob) : undefined,
    department,
    employmentType,
    branch,
  });

  // Send the invitation email
  const inviteLink = `http://localhost:3000/admin/accept-invite?token=${inviteToken}`;
  const mailOptions = {
    from: `"Munasaba App" <${process.env.EMAIL_USER}>`,
    to: email.toLowerCase(),
    subject: "Munasaba Staff Invitation",
    html: `
      <div style="font-family: 'Outfit', 'Inter', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 24px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 28px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: -0.025em;">Munasaba</h1>
          <p style="font-size: 14px; color: #64748b; margin-top: 4px;">Staff Onboarding Portal</p>
        </div>
        <h2 style="font-size: 20px; font-weight: 700; color: #1e293b; margin-top: 0; margin-bottom: 16px;">Hello ${firstName},</h2>
        <p style="font-size: 16px; line-height: 1.6; color: #475569; margin-bottom: 24px;">
          You have been invited to join the Munasaba team as a staff member with access to the admin panel. Please click the button below to set up your account and password.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${inviteLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 600; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 12px; transition: background-color 0.2s; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">
            Accept Invitation & Setup Account
          </a>
        </div>
        <p style="font-size: 14px; line-height: 1.6; color: #64748b; margin-bottom: 24px;">
          This secure invitation link is unique to you and will expire in 48 hours. If you did not expect this invitation, please ignore this email.
        </p>
        <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 16px; border-radius: 12px; margin-bottom: 32px;">
          <p style="font-size: 12px; color: #64748b; margin: 0; word-break: break-all;">
            If the button above does not work, copy and paste this URL into your browser:<br>
            <a href="${inviteLink}" style="color: #2563eb; text-decoration: none;">${inviteLink}</a>
          </p>
        </div>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;">
        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">&copy; 2026 Munasaba. All rights reserved.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Staff invitation sent to ${email}`);
  } catch (error) {
    console.error("Error sending staff invitation email:", error);
    // Note: User record remains created as pending, they can be re-invited or we can delete it.
    // For now, let's allow it but log the error.
  }

  await recordAdminAction({
    req,
    action: "STAFF_INVITED",
    targetType: "Admin",
    targetId: newAdmin._id,
    metadata: { email: newAdmin.email, roles: newAdmin.roles },
  });

  res.status(201).json({
    success: true,
    message: "Staff member invited successfully",
    data: {
      id: newAdmin._id,
      email: newAdmin.email,
      roles: newAdmin.roles,
    },
  });
});

// @desc Update staff roles
// @route PATCH /api/admin/staff/:id/roles
const updateStaffRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { roles } = req.body;

  if (!roles || !Array.isArray(roles)) {
    return res.status(400).json({ success: false, message: "Roles array is required" });
  }

  const staff = await Admin.findById(id);
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  const previousValue = { roles: staff.roles };
  staff.roles = roles;
  await staff.save();

  await recordAdminAction({
    req,
    action: "STAFF_ROLES_UPDATED",
    targetType: "Admin",
    targetId: staff._id,
    previousValue,
    newValue: { roles },
  });

  res.status(200).json({
    success: true,
    message: "Staff roles updated",
    data: { id: staff._id, roles: staff.roles },
  });
});

// @desc Update staff status (Active/Suspended)
// @route PATCH /api/admin/staff/:id/status
const updateStaffStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive, reason } = req.body;

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ success: false, message: "isActive boolean is required" });
  }

  const staff = await Admin.findById(id);
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  // Prevent suspending oneself
  if (req.user && req.user.id === id) {
     return res.status(403).json({ success: false, message: "Cannot suspend your own account" });
  }

  const previousValue = { isActive: staff.isActive, status: staff.status };
  staff.isActive = isActive;
  staff.status = isActive ? "active" : "suspended";
  await staff.save();

  await recordAdminAction({
    req,
    action: isActive ? "STAFF_REACTIVATED" : "STAFF_SUSPENDED",
    targetType: "Admin",
    targetId: staff._id,
    previousValue,
    newValue: { isActive },
    metadata: { reason },
  });

  res.status(200).json({
    success: true,
    message: isActive ? "Staff member reactivated" : "Staff member suspended",
    data: { id: staff._id, isActive: staff.isActive },
  });
});

// @desc Get single staff member by ID
// @route GET /api/admin/staff/:id
const getStaffById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const staff = await Admin.findById(id)
    .select("-password -refreshToken")
    .lean();

  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  res.status(200).json({
    success: true,
    data: { staff },
  });
});

// @desc Update staff password
// @route PATCH /api/admin/staff/:id/password
const updateStaffPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters",
    });
  }

  const staff = await Admin.findById(id);
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  staff.password = newPassword;
  staff.passwordChangedAt = new Date();
  staff.failedLoginAttempts = 0;
  await staff.save();

  await recordAdminAction({
    req,
    action: "STAFF_PASSWORD_RESET",
    targetType: "Admin",
    targetId: staff._id,
    metadata: { email: staff.email },
  });

  res.status(200).json({
    success: true,
    message: "Staff password updated successfully",
  });
});

// @desc Get staff activity log
// @route GET /api/admin/staff/:id/activity
const getStaffActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const staff = await Admin.findById(id).select("firstName surname email").lean();
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  let StaffActivity;
  try {
    StaffActivity = require("../../models/user/staffActivity.schema");
  } catch {
    return res.status(200).json({
      success: true,
      data: { activities: [], pagination: { total: 0, page: 1, pages: 0 } },
    });
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [activities, total] = await Promise.all([
    StaffActivity.find({ staff: id })
      .populate("organiser", "firstName surname email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    StaffActivity.countDocuments({ staff: id }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      staff,
      activities,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    },
  });
});

// @desc Delete staff member
// @route DELETE /api/admin/staff/:id
const deleteStaff = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const staff = await Admin.findById(id);
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  // Prevent deleting oneself
  if (req.user && req.user.id === id) {
     return res.status(403).json({ success: false, message: "Cannot delete your own account" });
  }

  await Admin.deleteOne({ _id: id });

  await recordAdminAction({
    req,
    action: "STAFF_DELETED",
    targetType: "Admin",
    targetId: staff._id,
    metadata: { email: staff.email },
  });

  res.status(200).json({ success: true, message: "Staff member deleted successfully" });
});

module.exports = {
  getStaffs,
  getStaffById,
  inviteStaff,
  updateStaffRole,
  updateStaffStatus,
  updateStaffPassword,
  getStaffActivity,
  deleteStaff,
};
