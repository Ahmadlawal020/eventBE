// Add declared worker/queue indexes only. Never drops indexes or edits financial records.
require("dotenv").config();
const mongoose = require("mongoose");
(async () => {
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    const results = [];
    for (const file of ["refundWorkerHealth", "eventCenterRefundWorkerHealth", "notificationOutbox", "eventCenterRefundOutbox", "operationalAlert", "eventCenterBooking"]) {
      const Model = require("../models/client/" + file + ".schema");
      if (process.argv.includes("--apply")) await Model.createIndexes();
      let actual = []; try { actual = await Model.collection.indexes(); } catch (error) { if (error.code !== 26) throw error; }
      const missing = Model.schema.indexes().filter(([keys, options]) => !actual.some(index => JSON.stringify(index.key) === JSON.stringify(keys) && Boolean(index.unique) === Boolean(options.unique))).map(([keys]) => keys);
      results.push({ model: Model.modelName, missing });
    }
    console.log(JSON.stringify({ applied: process.argv.includes("--apply"), results }, null, 2));
    if (results.some(row => row.missing.length)) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})().catch(error => { console.error("Worker index check failed:", error.name); process.exitCode = 1; });
