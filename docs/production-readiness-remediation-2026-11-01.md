# Event and venue readiness remediation - 1 November 2026

Worker architecture and dependency results were subsequently updated: see [worker remediation](worker-architecture-2026-11-01.md). The earlier 37-finding mobile count below is historical.

The confirmed application defects from the 31 October review have been addressed. This is not production sign-off: release configuration, deployed worker/alert verification, native-device acceptance, and the remaining dependency advisories still need completion.

## Changes

| Initial finding | Current result |
| --- | --- |
| Venue checkout cannot recover from initialization failure | Fixed. Exact matching reservations resume with their original payment reference, immutable amount and split destination. A database lease prevents concurrent initialization. Unknown provider outcomes return a pending verification response, and the mobile app preserves the reference. Completed matching bookings also recover through verification. |
| Tested dependencies differ from lockfiles | Lockfiles repaired. Clean npm ci installs verified for server, admin, and mobile; checks run against those installs. Security updates keep Expo SDK 54 and React Native 0.81.5. |
| Four legacy refunds require reconciliation | User confirmed these were development test data and authorized removal. Exactly four were removed, with recovery copies in development_refund_removal_backups. No pending notices were associated. Read-only readiness check now reports zero legacy refunds. |
| Stale operational workers | Persistent lease/heartbeat/error monitoring added for venue checkout, payout, reversal, review expiry, hold expiry and reminders. Actual deployed worker health still needs verification after rollout. |
| Deleted regression tests | Restored 24 missing tracked files. Updated obsolete auth/payment fixtures and added regression coverage for checkout concurrency/recovery, booking-window validation and venue operations alerts. |
| Development release configuration | Added npm run check:release (or -- --staging). It checks secrets, payment mode, stable HTTPS API URLs, matching clients, alert destination and CORS without revealing secret values. Local development configuration is preserved; production values have not been supplied. |
| Request/approval rescheduling horizon mismatch | Fixed. Request submission and approval now use the same platform booking-window validator. |
| Venue operational gaps invisible to alerts | Venue worker health, overdue checkout reconciliation, unresolved payments, reversal exceptions, failed/stalled payouts and manual-refund delivery health now feed the admin operations dashboard and existing external alert pipeline. |

Manual organiser refunds remain manual: the organiser transfers money externally, records proof and marks it sent; the recipient confirms receipt. Automatic provider reversals remain limited to unsuccessful bookings. No live payment or refund was submitted during this work.

## Validation

- Full server unit and integration suites passed after a clean lockfile install. Integration tests use temporary replica sets and mocked external providers.
- Mobile unit/regression suites: 85 tests passed, including the patched decoder and Metro image-size compatibility tests.
- Mobile and admin TypeScript checks passed.
- Admin production bundle passed; generated only in a temporary output directory.
- Android production JavaScript export passed after rebuilding the Metro cache: 4,885 modules and 66 assets. Output: `C:/Users/Ahmad/AppData/Local/Temp/munasaba-android-readiness-c0e3e287f4584ff3b7859029caa97b7d`. This verifies bundling, not installation or payment on a device.
- Read-only configured-database checks: required transaction/index checks pass, zero legacy refunds, and zero current payment/reversal/payout exception backlogs. Worker/alert readiness remains red because the required workers have not been verified in a running release environment and no external alert destination is configured.

## Dependency evidence

See [the updated dependency report](production-readiness-dependencies-2026-11-01.json). The command is npm audit --omit=dev --json. These counts include propagated dependency chains and, for the mobile app, build tooling; they are not counts of demonstrated application exploits.

Server and admin: zero findings. Mobile: zero high or critical findings; 36 moderate and one low dependency-chain findings remain rooted in deepmerge, glob and minimatch. Do not use npm audit fix --force to replace Expo or React Native independently. Complete a coordinated SDK/toolchain upgrade or a separately reviewed compatible patch before clearing this gate.

The [decoder advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) is addressed with decode-uri-component 0.5.1 and a reproducible CommonJS/ESM interop patch for the existing query-string API. The [image parser advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) is addressed with image-size 2.0.3 and a reproducible Metro compatibility patch that reads filename-based assets as bytes. Buffer and real asset-file paths have regression tests; the Android bundle passes. The [deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) currently lists no patched version; it remains explicitly reported.

## Release acceptance still required

1. Supply the intended release environment, stable API/admin origins and owned HTTPS alert webhook. Configure matching public/secret payment keys for staging or production in the hosting environment, not source control. Run npm run check:release with the appropriate target.
2. Deploy the reviewed version to the intended environment, then run npm run check:operations. Confirm fresh worker completions and delivery of an alert to the owned destination. No real workers or notifications were started as part of this repair.
3. Resolve or formally assess the remaining lower-severity toolchain advisory roots with compatibility evidence. Existing lower-severity development-only server/admin dependencies are outside the zero-production-dependency audit claim.
4. Perform native-device acceptance for checkout, interrupted payment recovery, host approval/decline, offline deposit/balance collection, manual refund proof/confirmation, ticket scanning, and notification delivery. A JavaScript export is not an Android/iOS native build or a live payment smoke test.

No deployment, production-key change, live transfer, or broad database cleanup was performed.
