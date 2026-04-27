require("dotenv").config();
const mongoose = require("mongoose");
const Event = require("../server/models/user/event.schema");
const EventCenter = require("../server/models/user/eventCenter.schema");

async function checkStatus() {
  try {
    await mongoose.connect(process.env.DATABASE_URI);
    console.log("Connected to MongoDB");

    const eventCounts = await Event.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    console.log("Event counts by status:", eventCounts);

    const eventCenterCounts = await EventCenter.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    console.log("Event Center counts by status:", eventCenterCounts);

    const eventsWithIsDraft = await Event.countDocuments({ isDraft: { $exists: true } });
    console.log("Events with legacy isDraft field:", eventsWithIsDraft);

    await mongoose.disconnect();
  } catch (err) {
    console.error("Error:", err);
  }
}

checkStatus();
