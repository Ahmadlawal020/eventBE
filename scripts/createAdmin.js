require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const connectDB = require("../config/dbConn");
const Staff = require("../models/management/staff.schema");
const User = require("../models/client/user.schema");
const IdentityVerification = require("../models/client/identityVerification.schema");
const { codeForUser } = require("../utils/referralCode");

const seedAdmin = async () => {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || "a@admin.com").trim().toLowerCase();
  const rawPassword = process.argv[3] || process.env.ADMIN_PASSWORD || "12345678";
  const role = process.argv[4] || process.env.ADMIN_ROLE || "super_admin";

  console.log("========================================");
  console.log(` Seeding Admin Account: ${email}`);
  console.log("========================================");

  await connectDB();

  // Compute password hash for User model (User model doesn't have a pre-save hash hook)
  const userPasswordHash = await bcrypt.hash(rawPassword, 10);

  // Check if User or Staff already exists
  let user = await User.findOne({ email });
  let admin = await Staff.findOne({ email });

  const targetId = user?._id || admin?._id || new mongoose.Types.ObjectId();

  // 1. Seed or update Staff / Admin model
  if (admin && user && admin._id.toString() !== user._id.toString()) {
    console.log(` Aligning Admin _id with User _id (${user._id})...`);
    await Staff.deleteOne({ _id: admin._id });
    admin = null;
  }

  if (admin) {
    admin.password = rawPassword; // pre('save') hook will hash it with 12 rounds
    admin.roles = [role];
    admin.isActive = true;
    admin.status = "active";
    admin.accountStatus = "Active";
    admin.failedLoginAttempts = 0;
    admin.accessLevel = "Tier 4 Executive";
    admin.accessScope = { type: "platform" };
    admin.emailVerified = true;
    await admin.save();
    console.log(` [Admin/Staff] Updated existing admin: ${email} (ID: ${admin._id})`);
  } else {
    admin = new Staff({
      _id: targetId,
      firstName: user?.firstName || "Admin",
      surname: user?.surname || "System",
      email,
      password: rawPassword, // pre('save') hook will hash it
      roles: [role],
      accessLevel: "Tier 4 Executive",
      accessScope: { type: "platform" },
      department: "Executive Management",
      jobTitle: "Super Administrator",
      employmentType: "Full-time",
      isActive: true,
      status: "active",
      accountStatus: "Active",
      emailVerified: true,
      failedLoginAttempts: 0,
    });
    await admin.save();
    console.log(` [Admin/Staff] Created new super admin: ${email} (ID: ${admin._id})`);
  }

  // 2. Seed or update Client User model
  let refCode = codeForUser(targetId);
  if (user) {
    user.password = userPasswordHash;
    user.authProvider = "local";
    user.isActive = true;
    user.isEmailVerified = true;
    user.emailVerifiedAt = user.emailVerifiedAt || new Date();
    user.isIdentityVerified = true;
    user.isPhoneVerified = true;
    user.phoneVerifiedAt = user.phoneVerifiedAt || new Date();
    user.roles = Array.from(new Set([...(user.roles || []), "user", "admin", "super_admin", "organiser"]));
    user.vendorAccountCode = user.vendorAccountCode || "SUB_ADMIN_000001";
    user.paystackSubaccountCode = user.paystackSubaccountCode || "SUB_ADMIN_000001";
    user.bankDetails = user.bankDetails || {
      accountName: "ADMIN SYSTEM",
      accountNumber: "1000000001",
      bankName: "Access Bank",
      bankCode: "044",
    };
    await user.save();
    console.log(` [User] Updated existing user: ${email} (ID: ${user._id})`);
  } else {
    user = await User.create({
      _id: targetId,
      firstName: "Admin",
      surname: "System",
      preferredFirstName: "Admin",
      email,
      password: userPasswordHash,
      dob: new Date("1990-01-01"),
      authProvider: "local",
      roles: ["user", "admin", "super_admin", "organiser"],
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      isPhoneVerified: true,
      phoneVerifiedAt: new Date(),
      isIdentityVerified: true,
      isActive: true,
      referralCode: refCode,
      vendorAccountCode: "SUB_ADMIN_000001",
      paystackSubaccountCode: "SUB_ADMIN_000001",
      bankDetails: {
        accountName: "ADMIN SYSTEM",
        accountNumber: "1000000001",
        bankName: "Access Bank",
        bankCode: "044",
      },
      residentialAddress: {
        country: "Nigeria",
        city: "Abuja",
        street: "1 Admin Way, Central Area",
        postalCode: "900001",
      },
      phoneNumber: "+2348000000001",
    });
    console.log(` [User] Created new user: ${email} (ID: ${user._id})`);
  }

  // 3. Ensure approved KYC verification record exists
  const existingKyc = await IdentityVerification.findOne({ userId: targetId });
  if (!existingKyc) {
    await IdentityVerification.create({
      userId: targetId,
      idType: "ID",
      idFrontImage: {
        url: "https://images.unsplash.com/photo-1544717305-2782549b5136?w=600",
        publicId: `admin/id_front_${targetId}`,
      },
      idBackImage: {
        url: "https://images.unsplash.com/photo-1544717305-2782549b5136?w=600",
        publicId: `admin/id_back_${targetId}`,
      },
      selfieImage: {
        url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600",
        publicId: `admin/selfie_${targetId}`,
      },
      status: "approved",
      reviewedAt: new Date(),
      reviewedBy: targetId,
    });
    console.log(" [KYC] Created approved identity verification record");
  }

  // Verify passwords for both models
  const reloadedStaff = await Staff.findById(targetId);
  const reloadedUser = await User.findById(targetId);
  const staffPassMatch = await bcrypt.compare(rawPassword, reloadedStaff.password);
  const userPassMatch = await bcrypt.compare(rawPassword, reloadedUser.password);

  console.log("\n========================================");
  console.log(" Admin account seeded successfully!");
  console.log("========================================");
  console.log(`Email:               ${email}`);
  console.log(`Password:            ${rawPassword}`);
  console.log(`Staff Role:          ${reloadedStaff.roles.join(", ")}`);
  console.log(`Staff Login Match:   ${staffPassMatch ? "PASS" : "FAIL"}`);
  console.log(`User Login Match:    ${userPassMatch ? "PASS" : "FAIL"}`);
  console.log("========================================\n");
};

seedAdmin()
  .catch((err) => {
    console.error("Error seeding admin:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log("Database connection closed.");
  });
