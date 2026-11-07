process.env.NODE_ENV = "test";
process.env.MONGOMS_RUNTIME_DOWNLOAD = "false";
process.env.QR_SIGNING_SECRET = "worker-tests-only";
const { test, mock } = require("node:test"), assert = require("node:assert/strict");
const mongoose = require("mongoose"), { MongoMemoryReplSet } = require("mongodb-memory-server");
const Health = require("../models/client/refundWorkerHealth.schema"), Alert = require("../models/client/operationalAlert.schema");
const { runWorker } = require("../services/eventOperations.service");
test("worker execution, alert retries and durable reminder delivery", { timeout: 120000 }, async t => {
  let db;
  try {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri(), { dbName: "isolated_worker_runtime" });
    await Promise.all([Health.init(), Alert.init(), require("../models/client/eventCenterRefundOutbox.schema").init()]);
    await t.test("task imports never start cron timers or execute work", () => {
      const cron = mock.method(require("cron").CronJob.prototype, "start", () => assert.fail("task import must not schedule work"));
      try { for (const file of require("node:fs").readdirSync(require("node:path").join(__dirname, "../jobs")).filter(file => file.endsWith(".job.js"))) require("../jobs/" + file); }
      finally { cron.mock.restore(); }
    });
    await t.test("lease and persisted cadence prevent concurrent and immediate repeat execution", async () => {
      let release, entered, calls = 0; const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const first = runWorker("venue-checkout", async () => { calls++; entered(); await gate; return { processed: 1 }; });
      await ready; assert.equal((await runWorker("venue-checkout", () => assert.fail("duplicate worker"))).skipped, true);
      release(); await first; assert.equal((await Health.findOne({ name: "venue-checkout" })).nextRunAt.getTime() % 60000, 0); assert.equal((await runWorker("venue-checkout", () => assert.fail("duplicate cadence"))).skipped, true);
      await Health.updateOne({ name: "venue-checkout" }, { $set: { nextRunAt: new Date(0) } });
      await runWorker("venue-checkout", async () => { calls++; }); assert.equal(calls, 2);
    });
    await t.test("expired leases recover after a process dies", async () => {
      await Health.create({ name: "dead-worker", lockedUntil: new Date(0), lockToken: "dead" });
      await runWorker("dead-worker", async () => ({ recovered: true }));
      const row = await Health.findOne({ name: "dead-worker" }); assert.equal(row.result.recovered, true); assert.ok(row.completedAt); assert.equal(row.completedRevision, process.env.RELEASE_SHA || "local");
    });
    await t.test("scheduler stops new work and drains running tasks", async () => {
      let release, entered, count = 0; const ready = new Promise(resolve => { entered = resolve; });
      const task = { name: "test-drain", cron: "0 0 1 1 *", run: async () => { count++; entered(); await new Promise(resolve => { release = resolve; }); } };
      const scheduler = require("../services/workerScheduler.service").startScheduler([task]); await ready;
      let drained = false; const stopping = scheduler.stop().then(() => { drained = true; });
      assert.equal((await scheduler.invoke(task)).skipped, true); assert.equal(drained, false); release(); await stopping;
      assert.equal(drained, true); assert.equal(count, 1); assert.equal(scheduler.active.size, 0);
    });
    await t.test("alert timeout persists the payload and retries with the same delivery ID", async () => {
      const old = process.env.EVENT_ALERT_WEBHOOK_URL; process.env.EVENT_ALERT_WEBHOOK_URL = "https://alerts.example.test/owned";
      const health = mock.method(require("../services/eventOperations.service"), "getEventOperations", async () => ({ alerts: ["Worker is stale"] }));
      const deliveries = []; const send = mock.method(require("axios"), "post", async (url, body, options) => {
        assert.equal(url, process.env.EVENT_ALERT_WEBHOOK_URL); assert.equal(options.maxRedirects, 0); deliveries.push({ body, key: options.headers["Idempotency-Key"] });
        if (deliveries.length === 1) throw Error("Timeout after remote acceptance"); return { status: 200 };
      });
      try {
        const { deliverEventAlerts } = require("../services/eventAlertDelivery.service");
        assert.equal((await deliverEventAlerts({ force: true })).pending, 1);
        await Alert.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });
        assert.equal((await deliverEventAlerts({ force: true })).pending, 0);
        assert.equal(deliveries.length, 2); assert.deepEqual(deliveries[0], deliveries[1]);
        await deliverEventAlerts({ force: true }); assert.equal(deliveries.length, 2);
        health.mock.restore(); mock.method(require("../services/eventOperations.service"), "getEventOperations", async () => ({ alerts: [] }));
        await deliverEventAlerts({ force: true }); assert.equal(deliveries.length, 3); assert.deepEqual(deliveries[2].body.alerts, []);
      } finally { mock.restoreAll(); if (old === undefined) delete process.env.EVENT_ALERT_WEBHOOK_URL; else process.env.EVENT_ALERT_WEBHOOK_URL = old; }
    });
    await t.test("failed event refund notices reach the external operations alert source", async () => {
      const Outbox = require("../models/client/notificationOutbox.schema");
      const row = await Outbox.collection.insertOne({ key: "failed-event-notice", failedAt: new Date(), completedAt: null });
      try {
        const operations = await require("../services/eventOperations.service").getEventOperations();
        assert.equal(operations.refunds.failed, 1);
        assert.ok(operations.alerts.some(message => message.startsWith("Event refunds: ") && message.includes("manual retry")));
      } finally { await Outbox.deleteOne({ _id: row.insertedId }); }
    });
    await t.test("standalone worker serves readiness from the expected release without loading the API", async () => {
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, [require("node:path").resolve(__dirname, "../worker.js")], { windowsHide: true,
        env: { ...process.env, DATABASE_URI: db.getUri("isolated_worker_process"), NODE_ENV: "test", QR_SIGNING_SECRET: "isolated-worker-only", WORKER_PORT: "0", WORKER_HOST: "127.0.0.1", RELEASE_SHA: "worker-test-revision", EVENT_ALERT_WEBHOOK_URL: "", PAYMENT_SECRET_KEY: "", RESEND_API_KEY: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      try {
        const port = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("Worker did not become ready")), 30000);
          child.stdout.on("data", chunk => { output += chunk; const match = output.match(/"workerPort":(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
          child.stderr.resume(); child.on("error", error => { clearTimeout(timer); reject(error); });
          child.on("exit", code => { clearTimeout(timer); reject(Error("Worker exited before readiness: " + code)); });
        });
        const response = await fetch("http://127.0.0.1:" + port + "/health/ready");
        const health = await response.json(); assert.equal(response.status, 200); assert.equal(health.ready, true); assert.equal(health.revision, "worker-test-revision"); assert.equal(health.service, "munasaba-worker");
        assert.equal((await fetch("http://127.0.0.1:" + port + "/api/events")).status, 404);
      } finally { child.kill(); await new Promise(resolve => child.once("exit", resolve)); }
    });
    await t.test("event reminders catch up, deduplicate recipients and exclude invalid ticket occurrences", async () => {
      const Event = require("../models/client/event.schema"), Ticket = require("../models/client/userEventTicket.schema"), Outbox = require("../models/client/eventCenterRefundOutbox.schema");
      const eventId = new mongoose.Types.ObjectId(), owner = new mongoose.Types.ObjectId(), excluded = new mongoose.Types.ObjectId();
      await Event.collection.insertOne({ _id: eventId, title: "Reminder test", status: "LISTED", occurrence: 2, schedule: { from: new Date(Date.now() + 3600000) } });
      await Ticket.collection.insertMany([
        { eventId, owner, status: "UNREDEEMED", occurrence: 2 },
        { eventId, owner, status: "UNREDEEMED", occurrence: 2 },
        { eventId, owner: excluded, status: "UNREDEEMED", occurrence: 1 },
        { eventId, owner: excluded, status: "UNREDEEMED", occurrence: 2, refundHold: true },
        { eventId, owner: excluded, status: "REDEEMED", occurrence: 2 },
      ].map((ticket, i) => ({ ...ticket, ticketNumber: "WORKER-TEST-" + i })));
      const { runNotificationChecks } = require("../services/notificationTriggers.service");
      await runNotificationChecks(); await runNotificationChecks();
      const rows = await Outbox.find({ type: "EVENT_REMINDER_24H" }).lean();
      assert.equal(rows.length, 1); assert.equal(String(rows[0].recipient), String(owner));
      assert.deepEqual(rows[0].channels, require("../constants/notificationTypes").TYPE_CONFIG.EVENT_REMINDER_24H.defaultChannels);
      await Outbox.deleteMany({ type: "EVENT_REMINDER_24H" }); await Event.deleteOne({ _id: eventId }); await Ticket.deleteMany({ eventId });
    });
    await t.test("bounded notification scans resume from persisted checkpoints after reloading the service", async () => {
      const Event = require("../models/client/event.schema"), Outbox = require("../models/client/eventCenterRefundOutbox.schema");
      const createdBy = new mongoose.Types.ObjectId();
      await Event.collection.insertMany(Array.from({ length: 105 }, (_, i) => ({ title: "Completed " + i, status: "COMPLETED", createdBy, occurrence: 0 })));
      const servicePath = require.resolve("../services/notificationTriggers.service");
      await require(servicePath).runNotificationChecks(); assert.equal(await Outbox.countDocuments({ type: "EVENT_COMPLETED" }), 100);
      assert.ok((await mongoose.connection.collection("worker_scan_checkpoints").findOne({ _id: "completed-notices" })).cursor);
      delete require.cache[servicePath]; await require(servicePath).runNotificationChecks();
      assert.equal(await Outbox.countDocuments({ type: "EVENT_COMPLETED" }), 105);
      assert.equal((await mongoose.connection.collection("worker_scan_checkpoints").findOne({ _id: "completed-notices" })).cursor, null);
      await Outbox.deleteMany({ type: "EVENT_COMPLETED" }); await Event.deleteMany({ createdBy });
    });
    await t.test("push-only reminders do not require email delivery and outbox enqueue is idempotent", async () => {
      const User = require("../models/client/user.schema"), Outbox = require("../models/client/eventCenterRefundOutbox.schema"), service = require("../services/eventCenterRefundNotifications.service");
      const id = new mongoose.Types.ObjectId(); await User.collection.insertOne({ _id: id, firstName: "Test", pushTokens: [] });
      const notice = { key: "worker-reminder-test", recipient: id, type: "VENUE_SESSION_REMINDER", title: "Test", message: "Test only", channels: ["in_app", "push"] };
      await Promise.all([service.queueNotices([notice]), service.queueNotices([notice])]); assert.equal(await Outbox.countDocuments({ key: notice.key }), 1);
      const email = mock.method(require("../services/email.service"), "sendEmail", () => assert.fail("push-only reminder must not email"));
      try { await service.processRefundNotices({ delayMs: 0 }); assert.ok((await Outbox.findOne({ key: notice.key })).completedAt); }
      finally { email.mock.restore(); }
    });
  } finally { mock.restoreAll(); await mongoose.disconnect(); if (db) await db.stop(); }
});
