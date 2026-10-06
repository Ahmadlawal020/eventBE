const asyncHandler = require("express-async-handler");
const Staff = require("../../models/management/staff.schema");
const { recordAdminAction } = require("../../services/management/adminAudit.service");
const { sendEmail } = require("../../services/email.service");

// Escape search string
const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const crypto = require("crypto");
const ASSIGNABLE_ROLES = ["super_admin", "finance_admin", "moderator"];
const isAssignableRole = (role) => ASSIGNABLE_ROLES.includes(role);
const cleanStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];

// @desc Get all staff members
// @route GET /api/admin/staff
const getStaffMembers = asyncHandler(async (req, res) => {
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
    const activeStatus = [{ status: "active" }, { status: { $exists: false } }];
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: activeStatus }];
      delete query.$or;
    } else {
      query.$or = activeStatus;
    }
  } else if (status === "suspended") {
    query.status = "suspended";
  } else if (status === "pending") {
    query.status = "pending";
  } else if (["deactivated", "terminated"].includes(status)) {
    query.status = status;
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [staffs, total] = await Promise.all([
    Staff.find(query)
      .select("-password -refreshToken")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Staff.countDocuments(query),
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

// @desc Invite a new staff member
// @route POST /api/admin/staff/invite
const inviteStaff = asyncHandler(async (req, res) => {
  const {
    firstName,
    surname,
    email,
    role,
    phoneNumber,
    gender,
    dob,
    department,
    jobTitle,
    employmentType,
    branch,
    team,
    organization,
    employeeId,
    manager,
    startDate,
    accessExpiresAt,
    accessScope,
    dataRestrictions,
    segregationRules,
    authenticationMethod,
    identityProviderId,
    mfaRequired,
    preferredLanguage,
    timezone,
    notificationPreferences,
    pageOverrides,
  } = req.body;

  if (!firstName || !surname || !email || !isAssignableRole(role)) {
    return res.status(400).json({ success: false, message: "First name, surname, email, and one valid admin role are required" });
  }

  const existingStaff = await Staff.findOne({ email: email.toLowerCase() }).exec();
  if (existingStaff) {
    return res.status(409).json({ success: false, message: "Staff member with this email already exists" });
  }

  if (accessExpiresAt && startDate && new Date(accessExpiresAt) <= new Date(startDate)) {
    return res.status(400).json({ success: false, message: "Access expiration must be after the access start date" });
  }
  if (authenticationMethod === "sso" && !identityProviderId?.trim()) {
    return res.status(400).json({ success: false, message: "An identity-provider identifier is required for SSO" });
  }

  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenHash = crypto.createHash("sha256").update(inviteToken).digest("hex");
  const inviteTokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  let geographicAccess;
  try { geographicAccess = await require("../../services/management/geography.service").validateAccess(req.body.geographicAccess || { mode: "scoped", grants: [] }); }
  catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
  const newStaff = await Staff.create({
    geographicAccess,
    firstName,
    surname,
    email: email.toLowerCase(),
    roles: [role],
    status: "pending",
    isActive: false,
    inviteToken: inviteTokenHash,
    inviteTokenExpiresAt,
    invitedBy: req.user?.id || null,
    invitedAt: new Date(),
    phoneNumber,
    gender,
    dateOfBirth: dob ? new Date(dob) : undefined,
    department,
    jobTitle,
    employmentType,
    branch,
    team,
    organization,
    employeeId,
    manager: manager || undefined,
    startDate: startDate ? new Date(startDate) : undefined,
    accessExpiresAt: accessExpiresAt ? new Date(accessExpiresAt) : null,
    accessScope: accessScope && typeof accessScope === "object" ? accessScope : undefined,
    dataRestrictions: cleanStringArray(dataRestrictions),
    segregationRules: cleanStringArray(segregationRules),
    authenticationMethod: authenticationMethod || "password",
    identityProviderId,
    mfaRequired: role === "super_admin" ? true : Boolean(mfaRequired),
    preferredLanguage: preferredLanguage || "en",
    timezone: timezone || "Africa/Lagos",
    notificationPreferences,
    pageOverrides: Array.isArray(pageOverrides) ? pageOverrides : [],
  });

  // Send the invitation email
  const baseUrl = process.env.ADMIN_WEB_URL || process.env.CLIENT_URL || "http://localhost:3000";
  const inviteLink = `${baseUrl.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

  try {
    await sendEmail({
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
    });
    console.log(`Staff invitation sent to ${email}`);
  } catch (error) {
    console.error("Error sending staff invitation email:", error);
  }

  await recordAdminAction({
    req,
    action: "STAFF_INVITED",
    targetType: "Staff",
    targetId: newStaff._id,
    metadata: { email: newStaff.email, roles: newStaff.roles },
  });

  res.status(201).json({
    success: true,
    message: "Staff member invited successfully",
    data: {
      id: newStaff._id,
      email: newStaff.email,
      roles: newStaff.roles,
    },
  });
});

// @desc Update staff roles
// @route PATCH /api/admin/staff/:id/roles
const updateStaffRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role, pageOverrides } = req.body;

  if (!isAssignableRole(role)) {
    return res.status(400).json({ success: false, message: "One valid admin role is required" });
  }

  const staff = await Staff.findById(id);
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  const previousValue = { roles: staff.roles };
  if (!staff.geographicAccess) staff.geographicAccess = require("../../services/management/geographicPolicy").accessFor(staff);
  staff.roles = [role];
  if (role === "super_admin") staff.mfaRequired = true;
  if (Array.isArray(pageOverrides)) staff.pageOverrides = pageOverrides;
  await staff.save();

  await recordAdminAction({
    req,
    action: "STAFF_ROLES_UPDATED",
    targetType: "Staff",
    targetId: staff._id,
    previousValue,
    newValue: { roles: staff.roles, pageOverrides: staff.pageOverrides },
  });

  res.status(200).json({
    success: true,
    message: "Staff roles updated",
    data: { id: staff._id, role: staff.roles[0] },
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

  const staff = await Staff.findById(id);
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
  staff.securityVersion += 1;
  staff.refreshToken = null;
  if (isActive) {
    staff.suspendedAt = null;
    staff.suspendedBy = null;
    staff.suspensionReason = undefined;
  } else {
    staff.suspendedAt = new Date();
    staff.suspendedBy = req.user?.id || null;
    staff.suspensionReason = typeof reason === "string" ? reason.trim() : undefined;
  }
  await staff.save();

  await recordAdminAction({
    req,
    action: isActive ? "STAFF_REACTIVATED" : "STAFF_SUSPENDED",
    targetType: "Staff",
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
  const staff = await Staff.findById(id)
    .select("-password -refreshToken +identityProviderId")
    .populate("manager", "firstName surname email")
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

  const staff = await Staff.findById(id);
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
    targetType: "Staff",
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

  const staff = await Staff.findById(id).select("firstName surname email").lean();
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  let StaffActivity;
  try {
    StaffActivity = require("../../models/client/staffActivity.schema");
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

// @desc Update staff profile
// @route PATCH /api/admin/staff/:id
const updateStaffProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { firstName, surname, phoneNumber, department, jobTitle, employmentType, branch, team, organization, employeeId, manager, startDate, accessExpiresAt, accessScope, dataRestrictions, segregationRules, authenticationMethod, identityProviderId, mfaRequired, preferredLanguage, timezone, notificationPreferences } = req.body;

  const staff = await Staff.findById(id);
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  const previousValue = {
    firstName: staff.firstName,
    surname: staff.surname,
    phoneNumber: staff.phoneNumber,
    department: staff.department,
    jobTitle: staff.jobTitle,
    employmentType: staff.employmentType,
    branch: staff.branch,
    team: staff.team,
    organization: staff.organization,
    employeeId: staff.employeeId,
    manager: staff.manager,
    startDate: staff.startDate,
    accessExpiresAt: staff.accessExpiresAt,
    geographicAccess: staff.geographicAccess,
    accessScope: staff.accessScope,
    dataRestrictions: staff.dataRestrictions,
  };

  if (req.body.geographicAccess !== undefined) {
    const ownRecord = String(staff._id) === String(req.user.id);
    const currentAccess = require("../../services/management/geographicPolicy").accessFor(staff);
    if (ownRecord && JSON.stringify(currentAccess) !== JSON.stringify(req.body.geographicAccess)) return res.status(403).json({ success: false, message: "Another global administrator must change your geographic access" });
    try { if (!ownRecord) staff.geographicAccess = await require("../../services/management/geography.service").validateAccess(req.body.geographicAccess); }
    catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
  }
  if (firstName !== undefined) staff.firstName = firstName;
  if (surname !== undefined) staff.surname = surname;
  if (phoneNumber !== undefined) staff.phoneNumber = phoneNumber;
  if (department !== undefined) staff.department = department;
  if (jobTitle !== undefined) staff.jobTitle = jobTitle;
  if (employmentType !== undefined) staff.employmentType = employmentType;
  if (branch !== undefined) staff.branch = branch;
  if (team !== undefined) staff.team = team;
  if (organization !== undefined) staff.organization = organization;
  if (employeeId !== undefined) staff.employeeId = employeeId;
  if (manager !== undefined) staff.manager = manager || null;
  if (startDate !== undefined) staff.startDate = startDate ? new Date(startDate) : null;
  if (accessExpiresAt !== undefined) staff.accessExpiresAt = accessExpiresAt ? new Date(accessExpiresAt) : null;
  if (staff.accessExpiresAt && staff.startDate && staff.accessExpiresAt <= staff.startDate) return res.status(400).json({ success: false, message: "Access expiration must be after the access start date" });
  if (accessScope !== undefined) staff.accessScope = accessScope;
  if (dataRestrictions !== undefined) staff.dataRestrictions = cleanStringArray(dataRestrictions);
  if (segregationRules !== undefined) staff.segregationRules = cleanStringArray(segregationRules);
  if (authenticationMethod !== undefined) staff.authenticationMethod = authenticationMethod;
  if (identityProviderId !== undefined) staff.identityProviderId = identityProviderId;
  if (staff.authenticationMethod === "sso" && !staff.identityProviderId?.trim()) return res.status(400).json({ success: false, message: "An identity-provider identifier is required for SSO" });
  if (mfaRequired !== undefined) staff.mfaRequired = staff.roles.includes("super_admin") ? true : Boolean(mfaRequired);
  if (preferredLanguage !== undefined) staff.preferredLanguage = preferredLanguage;
  if (timezone !== undefined) staff.timezone = timezone;
  if (notificationPreferences !== undefined) staff.notificationPreferences = notificationPreferences;

  await staff.save();

  const updated = await Staff.findById(id).select("-password -refreshToken").lean();

  await recordAdminAction({
    req,
    action: "STAFF_PROFILE_UPDATED",
    targetType: "Staff",
    targetId: staff._id,
    previousValue,
    newValue: { firstName: staff.firstName, surname: staff.surname, department: staff.department, geographicAccess: staff.geographicAccess },
  });

  res.status(200).json({
    success: true,
    message: "Staff profile updated",
    data: { staff: updated },
  });
});

// @desc Delete staff member
// @route DELETE /api/admin/staff/:id
const deleteStaff = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const staff = await Staff.findById(id);
  if (!staff) {
    return res.status(404).json({ success: false, message: "Staff member not found" });
  }

  // Prevent deleting oneself
  if (req.user && req.user.id === id) {
     return res.status(403).json({ success: false, message: "Cannot delete your own account" });
  }

  await Staff.deleteOne({ _id: id });

  await recordAdminAction({
    req,
    action: "STAFF_DELETED",
    targetType: "Staff",
    targetId: staff._id,
    metadata: { email: staff.email },
  });

  res.status(200).json({ success: true, message: "Staff member deleted successfully" });
});

module.exports = {
  getStaffMembers,
  getStaffById,
  updateStaffProfile,
  inviteStaff,
  updateStaffRole,
  updateStaffStatus,
  updateStaffPassword,
  getStaffActivity,
  deleteStaff,
};
