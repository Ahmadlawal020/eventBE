require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const connectDB = require("../config/dbConn");
const Staff = require("../models/management/staff.schema");
const User = require("../models/client/user.schema");

const seedAdmin = async () => {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || "b@b.com").trim().toLowerCase();
  const rawPassword = process.argv[3] || process.env.ADMIN_PASSWORD || "12345678";
  const role = process.argv[4] || process.env.ADMIN_ROLE || "super_admin";

  console.log(`Connecting to MongoDB...`);
  await connectDB();

  console.log(`Hashing password...`);
  const hashedPassword = await bcrypt.hash(rawPassword, 10);

  // Check if User already exists first to keep IDs synchronized
  let user = await User.findOne({ email });
  let admin = await Staff.findOne({ email });

  const targetId = user?._id || admin?._id || new mongoose.Types.ObjectId();

  // 1. Seed or update Staff / Admin
  if (admin && user && admin._id.toString() !== user._id.toString()) {
    console.log(`Aligning Admin _id with User _id (${user._id})...`);
    await Staff.deleteOne({ _id: admin._id });
    admin = null;
  }

  if (admin) {
    admin.password = hashedPassword;
    admin.roles = [role];
    admin.isActive = true;
    admin.status = "active";
    admin.accountStatus = "Active";
    admin.failedLoginAttempts = 0;
    admin.accessLevel = "Tier 4 Executive";
    await admin.save();
    console.log(`[Admin/Staff] Updated existing admin: ${email} (ID: ${admin._id})`);
  } else {
    admin = await Staff.create({
      _id: targetId,
      firstName: user?.firstName || "Super",
      surname: user?.surname || "Admin",
      email,
      password: hashedPassword,
      roles: [role],
      accessLevel: "Tier 4 Executive",
      department: "Management",
      jobTitle: "Super Administrator",
      employmentType: "Full-time",
      isActive: true,
      status: "active",
      accountStatus: "Active",
      failedLoginAttempts: 0,
    });
    console.log(`[Admin/Staff] Created new super admin: ${email} (ID: ${admin._id})`);
  }

  // 2. Seed or update User model
  if (user) {
    user.password = hashedPassword;
    user.authProvider = "local";
    user.isActive = true;
    user.isEmailVerified = true;
    user.emailVerifiedAt = user.emailVerifiedAt || new Date();
    user.roles = Array.from(new Set([...(user.roles || []), "user", "admin", "super_admin"]));
    await user.save();
    console.log(`[User] Updated existing user: ${email} (ID: ${user._id})`);
  } else {
    user = await User.create({
      _id: targetId,
      firstName: admin.firstName || "Super",
      surname: admin.surname || "Admin",
      email,
      password: hashedPassword,
      dob: new Date("1990-01-01"),
      authProvider: "local",
      roles: ["user", "admin", "super_admin"],
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      isPhoneVerified: true,
      phoneVerifiedAt: new Date(),
      isIdentityVerified: true,
      isActive: true,
    });
    console.log(`[User] Created new user: ${email} (ID: ${user._id})`);
  }

  console.log("\n========================================");
  console.log("Super Admin seeded successfully!");
  console.log(`Email:    ${email}`);
  console.log(`Password: ${rawPassword}`);
  console.log(`Role:     ${role}`);
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
