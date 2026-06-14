require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// Import the Staff model
const Admin = require("../models/admin/admin.schema");

const seedStaff = async () => {
  const dbUri = process.env.DATABASE_URI;
  if (!dbUri) {
    console.error("DATABASE_URI is not set in env variables");
    process.exit(1);
  }

  console.log("Connecting to database...");
  await mongoose.connect(dbUri);
  console.log("Database connected.");

  const commonPassword = "StaffPassword123!";
  console.log(`Hashing common password: "${commonPassword}"...`);
  const hashedPassword = await bcrypt.hash(commonPassword, 10);

  const rolesList = ["super_admin", "admin", "staff", "support"];
  const departments = ["Engineering", "Operations", "Finance", "Customer Success", "Marketing"];
  const branches = ["HQ - Austin, TX", "London Office", "Berlin Hub", "Tokyo Branch"];
  const genders = ["Male", "Female", "Other", "Prefer not to say"];

  console.log("Generating 100 staff users...");
  const staffToInsert = [];

  for (let i = 1; i <= 100; i++) {
    const role = rolesList[(i - 1) % rolesList.length];
    const department = departments[(i - 1) % departments.length];
    const branch = branches[(i - 1) % branches.length];
    const gender = genders[(i - 1) % genders.length];

    staffToInsert.push({
      firstName: `StaffMember`,
      surname: `${i}`,
      email: `staff.member${i}@munasaba.local`,
      password: hashedPassword,
      gender: gender,
      dateOfBirth: new Date(1980 + (i % 20), i % 12, (i % 28) + 1),
      phoneNumber: `+1512555${String(i).padStart(4, "0")}`,
      department: department,
      employmentType: "Full-time",
      branch: branch,
      roles: [role],
      accessLevel: i % 4 === 0 ? "Tier 4 Executive" : i % 3 === 0 ? "Tier 3 Senior" : "Tier 2 Management",
      teams: [department, `${branch.split(" ")[0]} Team`],
      isActive: true,
      status: "active",
      accountStatus: "Active",
      tfaEnabled: i % 5 === 0,
      failedLoginAttempts: 0,
      activeSessions: 0,
    });
  }

  console.log("Inserting staff users into MongoDB...");
  const result = await Admin.insertMany(staffToInsert);
  console.log(`Successfully inserted ${result.length} staff users.`);
};

seedStaff()
  .catch((err) => {
    console.error("Error seeding staff users:", err);
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log("Database connection closed.");
  });
