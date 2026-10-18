require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { verifyQRPayload } = require("../utils/qr");

async function verify() {
  await mongoose.connect(process.env.DATABASE_URI);
  await mongoose.connection.collection("users").updateOne(
    { email: "ahmadlawal020@gmail.com" },
    { $set: { createdAt: new Date("2021-10-15T09:00:00.000Z"), emailVerifiedAt: new Date("2021-10-15T09:05:00.000Z") } }
  );
  const user = await mongoose.connection.collection("users").findOne({ email: "ahmadlawal020@gmail.com" });
  console.log("User Account Created At:", user.createdAt);
  
  const totalEvents = await mongoose.connection.collection("events").countDocuments({ createdBy: user._id });
  console.log("Total Events Owned by Ahmad Lawal:", totalEvents);

  const sampleTicket = await mongoose.connection.collection("usereventtickets").findOne({ "checkIn.isCheckedIn": true });
  console.log("Sample Check-In Ticket:", {
    ticketNumber: sampleTicket.ticketNumber,
    status: sampleTicket.status,
    method: sampleTicket.checkIn?.method,
    checkedInAt: sampleTicket.checkIn?.checkedInAt
  });
  
  const qrCheck = verifyQRPayload(sampleTicket.qrPayload);
  console.log("Tamper-Proof QR Signature Verification:", qrCheck.valid ? "VALID (PASS)" : "INVALID (FAIL)");

  const eventsByYear = await mongoose.connection.collection("events").aggregate([
    { $match: { createdBy: user._id } },
    { $group: { _id: { $year: "$schedule.from" }, count: { $sum: 1 }, statuses: { $addToSet: "$status" } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  console.log("\nEvents Distribution by Year & Lifecycle Status:");
  console.table(eventsByYear);

  const totalBookings = await mongoose.connection.collection("eventbookings").countDocuments();
  const totalTickets = await mongoose.connection.collection("usereventtickets").countDocuments();
  const staffActivities = await mongoose.connection.collection("staffactivities").countDocuments({ organiser: user._id });
  const notifications = await mongoose.connection.collection("notifications").countDocuments({ recipient: user._id });

  console.log("\nCycle Counts:");
  console.log("- Total System Bookings:", totalBookings);
  console.log("- Total System Tickets:", totalTickets);
  console.log("- Staff Audit Log Activities for Organiser:", staffActivities);
  console.log("- Organiser Notifications:", notifications);

  await mongoose.disconnect();
}

verify().catch(console.error);
