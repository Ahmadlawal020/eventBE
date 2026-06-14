require("dotenv").config();

const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const connectDB = require("../config/dbConn");
const User = require("../models/user/user.schema");

const email = (process.env.ADMIN_EMAIL || "admin@munasaba.local")
  .trim()
  .toLowerCase();
const password = process.env.ADMIN_PASSWORD || "Admin@123456";

const createAdmin = async () => {
  await connectDB();

  const hashedPassword = await bcrypt.hash(password, 10);
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    existingUser.password = hashedPassword;
    existingUser.authProvider = "local";
    existingUser.isActive = true;
    existingUser.isEmailVerified = true;
    existingUser.emailVerifiedAt = existingUser.emailVerifiedAt || new Date();
    existingUser.roles = Array.from(
      new Set([...(existingUser.roles || []), "admin", "super_admin"]),
    );
    await existingUser.save();
  } else {
    await User.create({
      firstName: "Munasaba",
      surname: "Admin",
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
  }

  console.log(`Admin ready: ${email}`);
  console.log(
    "Password: use the ADMIN_PASSWORD env value or the default from this script.",
  );
};

createAdmin()
  .catch((error) => {
    console.error("Failed to create admin:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
