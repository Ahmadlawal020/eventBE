// Uses a temporary MongoDB database only; never loads application credentials.
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const CheckIn = require("../models/client/manualBookingCheckIn.schema");

test("manual check-ins persist and concurrent requests cannot create duplicates", { timeout: 90000 }, async () => {
  let database;
  try {
    database = await MongoMemoryServer.create();
    await mongoose.connect(database.getUri(), { dbName: "isolated_manual_check_in" });
    await CheckIn.init();
    const venue = new mongoose.Types.ObjectId();
    const actor = new mongoose.Types.ObjectId();
    const data = { _id: `${venue}:manual-one`, eventCenter: venue, bookingId: "manual-one", checkedInBy: actor, proofVerified: true };
    const results = await Promise.allSettled([CheckIn.create(data), CheckIn.create(data)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.equal(rejected.reason.code, 11000);
    const saved = await CheckIn.findOne({ eventCenter: venue, bookingId: "manual-one" }).lean();
    assert.equal(String(saved.checkedInBy), String(actor));
    assert.equal(saved.proofVerified, true);
    assert.ok(saved.checkedInAt instanceof Date);
    const otherVenue = new mongoose.Types.ObjectId();
    await CheckIn.create({ ...data, _id: `${otherVenue}:manual-one`, eventCenter: otherVenue });
    assert.equal(await CheckIn.countDocuments(), 2);
  } finally {
    await mongoose.disconnect();
    if (database) await database.stop();
  }
});
