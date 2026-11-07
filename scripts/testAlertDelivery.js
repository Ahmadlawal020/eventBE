// Explicit operator canary: only sends to the configured owned destination.
require("dotenv").config();
const mongoose = require("mongoose");
(async () => {
  if (!process.env.EVENT_ALERT_WEBHOOK_URL) throw Error("Configure the owned HTTPS alert endpoint first");
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    const result = await require("../services/eventAlertDelivery.service").deliverEventAlerts({ canary: true, force: true });
    console.log(JSON.stringify(result)); if (result.skipped || !result.delivered || result.pending) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})().catch(error => { console.error("Alert test failed:", error.message); process.exitCode = 1; });
