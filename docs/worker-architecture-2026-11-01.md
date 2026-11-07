# Worker architecture and remaining release checks - 1 November 2026

## What was wrong

Every API process imported and started its own cron timers. Several tasks used only process-local running flags. Reminders sent messages directly; a partially successful send could lose its retry path. Some scan positions lived only in memory, so worker restarts or different instances could repeatedly scan the first page. A successful outer task could also hide failed subtasks.

## Execution model

Run two persistent services from the same release:

- API: `npm start` (HTTP requests and payment webhooks; no scheduled jobs).
- Worker: `npm run worker` (schedules checks and consumes durable MongoDB work records).

Cron remains appropriate for checking deadlines, reconciling payment state, finding completed events, and cleaning expired uploads. It now runs only in the worker process. MongoDB reservations, payout/reversal state machines, and notification outboxes are the durable queues. Their record leases, immutable payment references and retry state survive process restarts. No Redis service was introduced solely to replace already durable queues.

`config/workerSchedule.js` is the single schedule registry. Task imports have no timer or startup-work side effects. Database leases and persisted next-run times prevent concurrent execution and immediate repeated execution across worker instances. Expired leases allow recovery after a crash. Scan checkpoints for notification triggers, venue reminders/completion and referral reconciliation now survive restarts. Worker shutdown stops timers and drains in-flight work, with a 30-second termination deadline.

Notifications are enqueued with unique keys and delivered through the existing channel-aware outbox. Retries preserve acknowledged channels; this is at-least-once delivery, not a claim of exactly-once push delivery. Reminder channels preserve the existing type configuration. Financial operations retain their provider-specific idempotency/reconciliation safeguards. Manual organiser refunds remain manual.

## Deployment

1. Install the reviewed lockfile with `npm ci`.
2. Run `npm run check:worker-indexes`. To add missing declared queue indexes, run `node scripts/ensureWorkerIndexes.js --apply`. The script never drops indexes or edits financial records.
3. Configure the same DATABASE_URI and required provider credentials for API and worker. Set RELEASE_SHA to the same actual deployment revision. Run API and worker as separate supervised persistent services; `Procfile` declares both commands. Do not place the persistent worker on a request-only/serverless service.
4. Worker health: `/health/ready` on WORKER_PORT (default 5002), served on WORKER_HOST (default 0.0.0.0). This confirms process/database readiness and release identity; task freshness is a separate check.
5. Set WORKER_HEALTH_URL to the owned HTTPS endpoint and EVENT_ALERT_WEBHOOK_URL to an owned HTTPS receiver. Optional EVENT_ALERT_WEBHOOK_TOKEN is sent as a Bearer header. The endpoint must accept the documented JSON payload below.
6. Run `npm run test:alert-delivery`, confirm receipt at the receiver, then run `npm run check:worker-deployment`. The latter checks process readiness, matching release identity, fresh successful task completions, and a recent acknowledged canary for the configured destination.

Use an external monitor for worker reachability. A stopped worker cannot notify you of its own outage. Poll the worker health endpoint and run task-freshness checks from monitoring outside that worker's process. Do not mark deployment verified from local test results.

## Alert delivery

Event and venue refund backlog/failure alerts both feed external delivery. Alerts now have durable OperationalAlert records, a frozen payload and stable delivery ID, retries with backoff, delivery acknowledgments, and destination-specific deduplication. Changes and recovery messages are queued; unchanged alerts are suppressed for 15 minutes. A timeout retries the same delivery ID. The receiver should honor Idempotency-Key to deduplicate uncertain acknowledgments.

Payload: `{ service: "event-operations", deliveryId, alerts: string[], canary: boolean, at }`. No customer payment or bank details are included. Redirects are disabled and each request times out after 10 seconds. Receipts confirm the receiver acknowledged HTTP delivery; a real test still requires confirmation in the owned monitoring service.

## Dependency remediation

Updated glob to 14.0.2 and minimatch to 11.0.1. Compatibility tests cover the older callable minimatch API, legacy React Native glob consumers, and cancellation of glob scans. Expo SDK 54 and React Native 0.81.5 are preserved.

The remaining deepmerge 4.3.1 prototype-poisoning issue has an explicit security backport in `munasaba/scripts/patch-dependencies.cjs`: reject unsafe keys when copying either input, including null-prototype targets. Tests cover target/source poisoning, nested arrays, and normal merge behavior. There is no upstream patched release listed by the advisory. npm audit still reports the original version and its dependent chains: 16 low findings, zero moderate/high/critical. These reports have not been hidden or falsely relabeled as zero vulnerabilities. Review the backport when upgrading deepmerge; install scripts must run in CI and release builds.

See [audit evidence](worker-remediation-dependencies-2026-11-01.json) and [the upstream advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).

## Verification and limits

Full server unit/integration suites pass, including worker lease/cadence recovery, scheduler draining, durable alert retries, recovery messages and channel-specific reminders. An actual standalone worker process was started against an isolated temporary database; its health endpoint and release identity were verified, and it did not serve API routes. Mobile tests (88), TypeScript and Android JavaScript export pass with the dependency patches.

Actual deployed-worker checks and owned-endpoint delivery remain pending: the deployment provider/service URL and alert receiver have not been supplied. No worker was started against the configured real database and no customer messages/payments were sent. Emulator testing was stopped at the user's request; native-device testing is not complete.

## Final verification update - 2 November 2026

The full server suite passed 455 tests. Mobile clean npm ci reproduced all security patches; 88 mobile tests and TypeScript passed afterward. Expo was restarted and its packager status verified. All declared worker/queue indexes are present. Worker readiness requires completion from the expected release, rather than merely a new release starting a task. The external deployment check correctly fails when WORKER_HEALTH_URL is absent. The final event-refund alert coverage change is also covered by a focused regression test.
