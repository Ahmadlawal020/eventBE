// Read-only: validates worker reachability, release identity, task freshness and alert acknowledgment.
require("dotenv").config();
const mongoose = require("mongoose");
(async () => {
  const target = process.env.WORKER_HEALTH_URL;
  if (!require("../services/releaseConfiguration.service").stableHttps(target)) throw Error("Set WORKER_HEALTH_URL to the deployed worker's HTTPS health endpoint");
  if (!process.env.RELEASE_SHA) throw Error("Set RELEASE_SHA to the expected deployed revision");
  const response = await require("axios").get(target, { timeout: 10000, maxRedirects: 0 });
  if (response.data?.service !== "munasaba-worker" || !response.data.ready || response.data.revision !== process.env.RELEASE_SHA) throw Error("Worker readiness or release identity does not match");
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  try {
    const rows = await require("../models/client/refundWorkerHealth.schema").find().lean();
    const failures = [];
    for (const task of require("../config/workerSchedule")) {
      const row = rows.find(item => item.name === task.name);
      if (!row?.completedAt || Date.now() - +new Date(row.completedAt) > Math.max(300000, task.intervalMs * 2) || row.completedRevision !== process.env.RELEASE_SHA || row.lastError || row.result?.failed || row.result?.deferred || row.result?.pending) failures.push(task.name);
    }
    const url = process.env.EVENT_ALERT_WEBHOOK_URL;
    const hash = url && require("crypto").createHash("sha256").update(new URL(url).href).digest("hex");
    const receipt = hash && await require("../models/client/operationalAlert.schema").findOne({ destinationHash: hash, canary: true, deliveredAt: { $gte: new Date(Date.now() - 86400000) } }).lean();
    if (!receipt) failures.push("owned alert endpoint has no recent acknowledged canary");
    console.log(JSON.stringify({ ready: failures.length === 0, revision: process.env.RELEASE_SHA, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
})().catch(error => { console.error("Worker deployment check failed:", error.message); process.exitCode = 1; });
