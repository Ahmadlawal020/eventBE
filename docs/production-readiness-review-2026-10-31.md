# Production readiness: events and event centres

> Remediation update: see [production-readiness-remediation-2026-11-01.md](production-readiness-remediation-2026-11-01.md) for current status. Findings below preserve the initial audit. The user subsequently identified the four legacy refunds as development test data and authorized their removal; that cleanup is complete.

Reviewed 31 October 2026. Verdict: neither flow should receive public production sign-off yet.

Scope: current local application code, tests and configuration; read-only checks of the database configured by server/.env; dependency advisories. The configured database has not been established as the intended production deployment. This review did not deploy or repair application code.

## Confirmed findings

### 1. P1 ? Venue checkout retry is blocked after initialization failure

[eventCenterTicket.controller.js](../controllers/client/eventCenterTicket.controller.js:90) only resumes a pending booking when checkoutAccessCode exists. Reservation occurs before provider initialization at line 195. If initialization fails or its result cannot be saved, the retry falls through to availability validation and conflicts with its own reservation.

Reproduced using a temporary replica set and mocked provider:
- First request: HTTP 500.
- Retry: HTTP 400, ?These dates are no longer available.?
- One pending booking remains, without a checkout code; only one initialization attempt occurred.

The buyer cannot resume through this path until expiry/reconciliation or intervention. This does not demonstrate a duplicate charge.

Required: resumable checkout attempts with the original reference, an initialization lease and a useful recovery response/client action. Do not release inventory or start another charge while the original outcome is uncertain.

### 2. P1 ? Tested dependencies differ from the release lockfile

| Server package | Installed/tested | Locked |
| --- | --- | --- |
| express | 4.22.2 | 4.21.2 |
| axios | 1.20.0 | 1.11.0 |
| mongoose | 8.24.4 | 8.18.0 |
| jws | 3.2.3 | 3.2.2 |
| joi | 18.2.5 | 18.0.2 |

Passing tests against this node_modules directory does not establish what a clean npm ci deployment would run.

Production-dependency lockfile audits, using npm audit --omit=dev --json:

| Repository | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| server | 1 | 9 | 3 | 0 | 13 |
| munasaba | 1 | 14 | 39 | 1 | 55 |
| eventmdb | 2 | 3 | 0 | 0 | 5 |

These are package findings, including transitive chains, not demonstrated application exploits. Frontend dependency classification can include build/dev tooling even with --omit=dev.

The critical [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) requires particular IPv4-mapped IPv6 trust-subnet configurations. The app uses numeric trust proxy = 1; this review did not establish that exploit. The [jws advisory](https://github.com/advisories/GHSA-869p-cjfg-cm3x) explicitly excludes the jws.verify interface used by jsonwebtoken. Other advisories need their own applicability review.

Required: deliberate compatible upgrades, synchronized lockfiles, and clean-install tests/builds. Do not blindly apply npm audit fix --force: some mobile findings propose a major expo-router upgrade that needs Expo compatibility testing. See [dependency snapshot](production-readiness-dependencies-2026-10-31.json).

### 3. P1 ? Four event refund records need financial reconciliation

Both read-only commands confirmed the existing issue:
- node scripts/checkRefundReadiness.js --database
- node scripts/migrateTicketRefunds.js (report mode, without --apply)

All four legacy records report: ?Stored refund amount differs from checkout; manual review required.?

Required: reconcile the original purchase, intended obligation, recipient and any payment evidence before migration. Do not guess a replacement amount, duplicate a payment or mark money sent. This requires a finance/operator decision.

### 4. P1 ? Worker health and alert delivery fail readiness

The configured database reports stale event completion, payment reconciliation, media-cleanup and refund-operation health. Venue refund operations report stale/missing notifications, overdue processing, receipt cleanup and manual-receipt cleanup. Observed event worker completions were last recorded on 30 October around 20:30?20:32 UTC.

EVENT_ALERT_WEBHOOK_URL is absent. The readiness command exits unsuccessfully.

This confirms stale recorded health in the checked environment; it does not prove an unidentified production deployment is down. Required: matching deployed API/workers, fresh successful runs, an owned alert destination and demonstrated failure/recovery alerts. No workers were started by this review.

### 5. P1 ? Event regression tests are missing from the checkout

Git reports 24 deleted test files, including paymentCheckout.integration.spec.cjs and event refund, cancellation, pricing and scanning suites. Normal test commands no longer run that coverage.

The saved integration suite was loaded from HEAD and executed in memory without restoring files:
- Original suite: 118/123 passed.
- Five failures came from an undefined lifecycle helper and outdated authentication fixtures: missing JWT accountType and missing Google email_verified.
- Correcting only those fixtures in memory: 123/123 passed against current application code.

Required: restore or replace intended regression tests, update fixtures and include them in clean-install CI. The passing in-memory audit run is not persistent coverage.

### 6. P1 deployment gate ? Local configuration is for development

Sanitized inspection found:
- NODE_ENV is Development.
- Payment credentials are test-mode credentials.
- Mobile local API configuration uses a temporary tunnel.
- Admin local API configuration uses localhost over HTTP.
- No custom CORS origin list is configured.

These observations do not establish remote EAS/hosting settings. The successful admin build proves compilation, not a production-ready API destination.

Required: verify stable HTTPS endpoints, intended payment mode, release environment variables, CORS/cookies, deployed secrets and actual proxy topology. Verify the settings embedded in the released clients.

### 7. P2 ? Reschedule requests omit the platform booking horizon

[venueReschedule.controller.js](../controllers/client/venueReschedule.controller.js:20) validates venue timing/price but omits the platform horizon that [venueLifecycle.service.js](../services/venueLifecycle.service.js:72) checks during approval.

Reproduced with a one-month platform limit: a request for a date 60 days ahead returns HTTP 200; organiser approval returns HTTP 400, ?Dates exceed the platform booking window.? Existing occupancy remains protected.

Required: reject such requests at submission while retaining the approval-time recheck.

### 8. P2 ? Venue payment-worker monitoring needs broader coverage

The inspected venue checkout/completion, payout and provider-refund jobs do not expose the persisted health/backlog monitoring provided for event jobs by eventOperations.service.js. Venue refund operations monitor outbox, overdue and receipt-cleanup work, which does not cover all payment jobs.

Payout/refund per-record leases already exist; no duplicate transfer was demonstrated. Add heartbeat, backlog and failure alerts for checkout reconciliation, review expiry, payouts and provider reversals, and verify multi-process operation.

## Verified strengths

Event tests exercise inventory/capacity races, ticket issuance, duplicate callbacks, rollback, transfers, current-holder refunds, settlement holds, scanning, occurrence expiry/carry-over and durable notices.

Venue tests exercise reservation conflicts, calendar finance permissions, scheduling limits, checkout expiry, late-payment reversal, completion, manual refund bank locking/private proof/confirmation, archive protection and review eligibility.

The configured MongoDB supports transactions. Checked event and venue unique index keys are present. At inspection, venue counts for overdue pending payments, pending checkouts without codes, payment exceptions, payout attention and legacy direct refunds were zero. Existing-data counts do not negate reproduced failure paths.

The agreed model remains: one exclusive venue per listing; full online payment upfront; offline deposits/balances; organiser-paid manual cancellation refunds; automatic provider reversals only for unsuccessful venue bookings.

## Validation

| Check | Result |
| --- | --- |
| Current server unit suite | 86 passed |
| Current server integration suite | 61 reported tests passed |
| Saved event/payment integration suite | 123 passed after fixture-only in-memory corrections |
| Targeted venue defect checks | Both reproduced |
| Selected mobile logic/form tests | 70 passed |
| Mobile/admin TypeScript | Passed |
| Admin production compilation | Passed, output in a temporary directory |
| Configured-database readiness | Failed: legacy refunds, stale health, missing alerts |
| Refund migration preview | Four records require manual review |
| Dependency audits | Findings above; mobile succeeded on retry |

Suites overlap, and reported integration totals include parent tests; do not add them as distinct business scenarios.

No package upgrades, application fixes, index changes, financial-data changes or deployment were performed. Integration writes used temporary local databases with mocked external operations. Configured-database inspection was read-only. The admin build can regenerate router metadata as part of its normal build.

## Remaining release acceptance

After addressing these findings, verify matching API/mobile/admin builds in staging:

1. Event publish, free/paid checkout, lost responses, duplicate webhooks, transfer, simultaneous scans, cancellation and occurrence completion.
2. Venue instant/review checkout, acceptance/decline/timeout, reversals, concurrent online/manual bookings, deposits/balances, rescheduling and manual refunds.
3. Actual provider test-mode callbacks, private uploads, email/push delivery and worker restart recovery.
4. Physical Android/iOS payment and camera/receipt flows, network interruption and cross-device refresh.
5. Peak checkout/scanner load, backup restoration, alert delivery and an assigned owner for payment/refund exceptions.

Public launch should wait for the code/release defects, financial reconciliation and operational acceptance evidence. Passing local tests alone is insufficient.
