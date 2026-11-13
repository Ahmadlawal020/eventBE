// Explicit deployment migration. Does not drop indexes or change listing data.
require("dotenv").config();
const mongoose = require("mongoose");
async function main() {
  if (!process.env.DATABASE_URI) throw Error("DATABASE_URI is required");
  await mongoose.connect(process.env.DATABASE_URI,{ autoIndex:false });
  const models = require("../models/client/discovery.schema");
  for (const model of Object.values(models)) await model.createIndexes();
  const Event = require("../models/client/event.schema");
  const Venue = require("../models/client/eventCenter.schema");
  await Event.collection.createIndex({ status:1,"location.countryCode":1,"location.city":1,"schedule.from":1,_id:1 },{ name:"discovery_local_events" });
  await Event.collection.createIndex({ status:1,eventType:1,"schedule.from":1,_id:1 },{ name:"discovery_category_events" });
  await Venue.collection.createIndex({ status:1,"location.countryCode":1,"location.city":1,createdAt:-1,_id:-1 },{ name:"discovery_local_venues" });
  await Venue.collection.createIndex({ status:1,venueType:1,createdAt:-1,_id:-1 },{ name:"discovery_category_venues" });
  console.log("Discovery indexes created.");
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; }).finally(()=>mongoose.disconnect());
