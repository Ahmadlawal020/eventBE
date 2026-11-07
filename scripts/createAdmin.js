require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/dbConn");
const Staff = require("../models/management/staff.schema");
async function createAdmin() {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || "";
  const role = process.argv[4] || process.env.ADMIN_ROLE || "super_admin";
  if (!email || password.length < 12 || Buffer.byteLength(password) > 72) throw new Error("Provide an explicit ADMIN_EMAIL and ADMIN_PASSWORD (12 characters minimum, 72 bytes maximum).");
  if (!["super_admin", "finance_admin", "moderator"].includes(role)) throw new Error("Invalid administrator role.");
  await connectDB();
  let staff = await Staff.findOne({ email });
  if (!staff) staff = new Staff({ email, firstName: "Admin", surname: "Account" });
  staff.password = password;
  staff.roles = [role];
  staff.isActive = true;
  staff.status = "active";
  staff.accountStatus = "Active";
  staff.failedLoginAttempts = 0;
  staff.lockoutUntil = null;
  staff.refreshToken = "";
  staff.sessionVersion = (staff.sessionVersion || 0) + 1;
  staff.geographicAccess = { mode: role === "super_admin" ? "global" : "scoped", grants: [] };
  await staff.save();
  console.log("Administrator saved:", String(staff._id), email, role);
}
createAdmin().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.connection.close());
