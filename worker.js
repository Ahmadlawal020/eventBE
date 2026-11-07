require("dotenv").config();
const mongoose = require("mongoose"), http = require("node:http");
const { startScheduler } = require("./services/workerScheduler.service");
let scheduler, server, closing = false;
async function shutdown(exitCode = 0) {
  if (closing) return; closing = true;
  const deadline = setTimeout(() => process.exit(1), 30000); deadline.unref();
  try { if (server) server.close(); if (scheduler) await scheduler.stop(); await mongoose.disconnect(); }
  finally { clearTimeout(deadline); process.exitCode = exitCode; }
}
async function main() {
  require("./utils/qr");
  if (!process.env.DATABASE_URI) throw Error("DATABASE_URI is required");
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: process.env.NODE_ENV !== "production", serverSelectionTimeoutMS: 10000 });
  const Health = require("./models/client/refundWorkerHealth.schema");
  if (process.env.NODE_ENV !== "production") await Health.init();
  const indexes = await Health.collection.indexes();
  if (!indexes.some(index => index.unique && index.key.name === 1 && Object.keys(index.key).length === 1)) throw Error("Worker lease unique index is missing; run the index migration before starting workers");
  scheduler = startScheduler();
  server = http.createServer((req, res) => {
    if (!["/health", "/health/ready", "/health/live"].includes(req.url)) { res.writeHead(404); return res.end(); }
    const ready = !closing && mongoose.connection.readyState === 1;
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "munasaba-worker", ready, revision: process.env.RELEASE_SHA || null, activeTasks: scheduler.active.size }));
  });
  server.on("error", error => { console.error("[WORKER SERVER]", error.code); void shutdown(1); });
  server.listen(Number(process.env.WORKER_PORT || 5002), process.env.WORKER_HOST || "0.0.0.0", () => console.log(JSON.stringify({ workerPort: server.address().port })));
}
process.on("SIGTERM", () => void shutdown()); process.on("SIGINT", () => void shutdown());
process.on("unhandledRejection", () => void shutdown(1)); process.on("uncaughtException", () => void shutdown(1));
main().catch(error => { console.error("[WORKER STARTUP]", error.message); void shutdown(1); });
