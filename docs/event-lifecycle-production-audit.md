# Event lifecycle production audit

> Follow-up: [Event occurrence and release fixes](event-occurrence-release-fixes.md) supersedes the findings below about completed-event reuse, automatic publishing, event purchase notice durability, payment-exception visibility, public email exposure and reservation sales-window checks. Other release gates remain open.

Reviewed 19 October 2026. Verdict: **not approved for production yet**. This pass reviewed the event code paths and fixed the verified issues below. Passing local tests does not establish live provider delivery, deployed database correctness, device behavior or peak-event capacity. Existing unrelated workspace changes were preserved.

## Lifecycle coverage

| Stage | Reviewed behavior | Assessment |
| --- | --- | --- |
| Draft creation and editing | Required fields, safe patch fields, event settings, policy normalization, media permissions | Validation tested; description limits and public response privacy still need alignment |
| Publishing and discovery | Organiser requirements, LISTED visibility, cancelled listing exclusion, ticket-tier visibility | Direct ticket visibility fixed; automatic verification-triggered publishing needs revalidation |
| Ticket configuration | Inventory integers, money in minor units, sales windows, editable fields, ownership | Protected fields and sale races fixed; tier mutation lifecycle transactions still incomplete |
| Checkout | Server prices, item quantities/duplicates, order limits, transactional reservation, quote versions | Verified protections; sales-window boundary race and operational payment exceptions remain |
| Payment completion | Provider amount/currency/reference, concurrent webhook/client calls, expiry and late payment | Idempotent issuance tested; exception handling requires a visible operations queue |
| Free tickets | Atomic issuance with no monetary refund obligation | Tested; cancellation still invalidates entry and queues notices |
| Transfer/gifting | Current owner, accepted request, QR rotation, cancellation race | Initiation/acceptance and notices now transactional; decline/cancel notices remain best effort |
| Scanning and check-in | Organiser/staff permissions, duplicate scans, event end/status, old QR rejection | Shared atomic entry service tested; scanner UI now displays closed entry |
| Completion | Explicit end date, legacy 24-hour fallback, configured completion job | Tested; unsafe reuse of completed events remains a blocker |
| Cancellation | Owner authorization, irreversible cancellation, ticket invalidation, transfer cancellation, refund/outbox transaction | Tested, including rollback and payment/transfer/check-in races |
| Refunds | Current holder, bank details, private receipt, mark paid, confirmation/dispute, audited recovery | Automated lifecycle coverage passes; actual bank settlement and provider/device checks remain external |
| Operations | Refund workers, retry/backlog health, receipt cleanup, payment reservation retry | Refund monitoring exists; payment/completion monitoring needs further work |

## Fixed in this review

1. **Duplicate or late entry:** organiser validation, staff scanning and staff ticket check-in use `services/eventEntry.service.js`. An event write serializes entry with cancellation, completion and transfer. Only an unredeemed ticket can be redeemed; cancelled/completed/ended events and missing schedules fail closed. Accepted UNLISTED events retain entry, so stopping discovery does not strand existing holders.
2. **Staff authorization:** staff ticket check-in requires SCAN_TICKET or ALL_ACCESS. Staff ticket cancellation requires ALL_ACCESS and conditionally changes only the current unused ticket. Undo check-in cannot reopen completed/cancelled events.
3. **Scanner display:** verification returns event status and entry closure. Both event verification screens hide redemption and display closed/cancelled entry. The backend remains authoritative if cancellation happens after verification.
4. **Transfer partial commits:** initiation and acceptance now commit request state, ticket ownership, rotated QR and durable notice together. A failed outbox write rolls everything back. Old QR codes fail after a transfer.
5. **Media access:** legacy event image/performer edit endpoints check organiser permissions and image membership. Public media deletion removes the event reference without destroying an unverified Cloudinary ID. Public upload ownership is not yet registered; retaining the storage object prevents malicious deletion of another asset. Private refund receipt cleanup retains its existing ownership/evidence checks.
6. **Ticket patch protection:** field whitelisting rejects event ownership, sold quantity, operators and dotted writes. Conditional update guards detect price/inventory edits and sales races. Tier deletion requires no sold inventory at deletion time.
7. **Inventory and amounts:** model validation rejects negative/fractional inventory and fractional minor-unit prices. Checkout rejects duplicate tiers, malformed IDs, fractional/zero quantities, excessive total quantities and tier order limits.
8. **Price changes during checkout:** reservation checks the quoted ticket version and event relationship. A changed quote is rejected rather than charging a stale price. Transactions roll back all items when a later reservation fails.
9. **Ended events and late payments:** reservation rejects ended events. A successful late payment after event completion/end is recorded for reconciliation and cannot issue usable tickets. Cancellation-related late payments continue through the cancellation refund path.
10. **Unsupported direct transfer checkout:** event checkout accepts CARD or FREE. The unimplemented TRANSFER settlement route is rejected, preventing an indefinite reservation through that path. Legacy stored payment method values remain readable.
11. **Reservation retry storm:** uncertain provider errors record attempts and retry after 5, 10, 20, 40 and then 60 minutes. Least recently attempted records are checked first. Only explicit transaction-not-found errors allow missing-payment expiry; generic HTTP 400/404 and network errors retain inventory. A provider configuration problem still requires correction; backoff does not make it a successful payment. The worker does not start during node:test.
12. **Public tier exposure:** list reads require a valid eventId; both list/detail reads apply event visibility with optional JWT. Public callers cannot read draft, unlisted, cancelled or completed tiers. Organisers retain access to their own drafts. The organiser hook waits until an eventId exists.
13. **Payment verification authorization:** the legacy event ticket verification route now requires JWT.

## Remaining release blockers and priorities

### High: completed-event reuse and rescheduling

`controllers/client/event.controller.js:updateEvent` can move a completed event back to LISTED by changing its dates, retaining old ticket records. Existing unused tickets could become usable for the new dates; redeemed tickets and frozen event snapshots retain their old meaning. Date changes update the event first and realign ticket sales afterward, outside one transaction. Holder rescheduling notices are not durably queued by this path.

Choose and implement an occurrence policy before release: completed occurrences should normally stay immutable and new dates use a new event/occurrence. Rescheduling an active paid event needs atomic schedule/tier updates, durable holder notices and an explicit ticket/refund policy. Test failures between these operations and reuse of old QR codes.

### High: automatic publishing bypasses current event validation

`controllers/client/event.controller.js:syncUserEvents` bulk-promotes ACTION_REQUIRED events when an organiser becomes verified. It checks the organiser but does not revalidate each event's dates, content, location or current regional settings. An event awaiting verification can become stale before this promotion. Use per-event current validation and a conditional write; retain invalid events in ACTION_REQUIRED with an actionable reason.

### High: payment exception recovery and reliable purchase notices

`services/paymentCompletionNotifications.service.js` sends purchase notices after payment commits, catches failures, and skips unchanged replays. The free-purchase controller also handles its notice as best effort. A process crash or provider failure can lose a purchase email/notice. Move these notices into the same durable transactional outbox used by cancellation and transfer acceptance, preserving receipt content and preventing duplicates.

`paymentResolutionRequired` records late/expired/conflicting payments, including payment after event end. There must be an operational queue with ownership, audited resolution, safe refund handling and alerts. Do not assume these records all appear in the cancellation refund workspace: a non-cancelled event's late payment does not create that cancellation obligation. Referral/notification failures must not misrepresent a committed payment as an uncommitted checkout.

### High: paid ticket voids and cancellation eligibility need a product decision

`staffTicket.controller.js:staffCancelTicket` voids an unused ticket but does not create a refund obligation. ALL_ACCESS permission now limits this action, but an operational settlement/support policy is still required for paid voids. Cancellation currently excludes redeemed and previously cancelled tickets from refund eligibility. Confirm this rule explicitly for cancellation after admission; change the calculation and UI together if admitted holders must also be refunded. Current-holder ownership applies to eligible transferred tickets.

### Medium: concurrency and authorization consistency

Ticket create/update/delete checks the event lifecycle before its final tier write; all tier mutations should take the same event transaction lock to prevent edits completing after cancellation. Recheck the actual sales window inside reservation as well as its version: the clock can cross salesEndAt without any tier edit. Validate tier minimum <= maximum together. Co-organiser checks in the main event update and performer paths should consistently bind the accepted invitation to the event's current organiser, as the media helper and ticket permission check now do.

### Medium: public response privacy and content limits

Public event reads populate organiser/co-organiser/staff email addresses. Define a public DTO with the minimum public profile fields; reserve contact and staff details for authorised management views.

The draft description component allows 500 characters while default server maxDescriptionLength is 250. Creation and editor screens should consume the published event settings and stage validation should use the same limits. Do not silently truncate already entered text.

### Medium: lifecycle operations, media ownership and scale

- Give payment reconciliation and event completion worker heartbeats, oldest backlog/error metrics and alerts. Payment retries now back off indefinitely for unresolved provider errors; staff must be alerted rather than relying only on logs. Multiple API processes still need coordinated worker claims or a designated worker deployment.
- Expire pending transfers when an event completes and make decline/cancel notices durable if those notices are guaranteed.
- Register trusted public uploads and perform safe orphan cleanup. Media reference removal currently retains storage assets intentionally.
- Entry currently permits early check-in while the event is LISTED/UNLISTED, before its scheduled start. Define an early-entry window if required; no restrictive start window was invented in this review.
- Entry transactions serialize on one event document. This improves correctness but needs load testing for expected simultaneous gates/scanners, transaction retry latency and notification backlogs.
- Staff ticket detail screens should hide actions lacking the required permission instead of relying only on server 403 responses.

## Validation completed

- **129 unit/HTTP tests passed**, zero failures, covering lifecycle entry, settings, policies, performers, pricing, sales windows, undo check-in, payment, cancellation, receipt HTTP/privacy, refund notices, bank details, public listing cancellation, ticket dashboards, refund allocation, reservation retry and tier visibility.
- **36 isolated MongoDB replica-set integration tests passed**, zero failures. These include transaction rollback, concurrent issuance/expiry, cancellation/transfer/check-in races, current-holder refunds, bank/proof/paid/dispute/confirmation, private upload attempts and cleanup, recovery audit, workspace pagination, notification retries, media permissions, quote versions and event-end handling. No application database, real payment provider, email or Cloudinary provider was used.
- App TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false` passed.
- Targeted lint for the two scanner screens and staff scanner API: zero errors, eight existing warnings (unused values, existing effect dependency and array notation).

The integration suite also contains venue payment/availability regression checks because those share checkout services. This audit does not claim complete venue lifecycle coverage or full automated UI coverage.

New focused suites: `tests/eventLifecycleReadiness.unit.spec.cjs`, `tests/paymentReservationExpiry.unit.spec.cjs`, `tests/eventTicketVisibility.unit.spec.cjs`. Transaction coverage is in `tests/paymentCheckout.integration.spec.cjs`.

## Deployment and acceptance gates

1. Resolve the high-priority code/policy items above. Deploy matching server/app versions; ticket-tier list endpoints now require eventId and unsupported direct-transfer event checkout is rejected.
2. Confirm a transaction-capable MongoDB deployment, declared indexes, completed per-ticket refund migration and review of historical manual-review records. Do not run destructive index synchronization blindly. Check query plans for reservation retry/backlog load.
3. Run the read-only `node scripts/checkRefundReadiness.js --database` in the target environment and review topology/index/migration/worker results. No production database audit was run in this pass.
4. Verify stable QR signing secrets, correct gateway credentials/webhook validation, persistent worker processes and operational alert routing. Resolve HTTP 400 configuration errors rather than clearing their reservations manually.
5. With designated test accounts/provider test mode, exercise draft -> publish -> free/paid purchase -> gift transfer -> old/new QR -> simultaneous check-in -> completion; separately cancel before payment, during payment and after transfer. Test both owner and restricted staff.
6. On Android/iOS, verify gallery/camera receipt upload, private proof viewing, bank submission, organiser proof/paid actions, holder confirmation/dispute, correction support, cancellation email/in-app receipt, offline/retry and cross-account denial. Record actual delivery instead of treating a queued notice as delivered.
7. Exercise provider timeouts, worker restart after commit, duplicate webhooks, a large sold-out event and concurrent gates. Review payment exceptions, oldest outbox records and support ownership. A receipt records supplied evidence; it does not verify external bank settlement.

Use `docs/cancellation-refund-audit.md` for the existing refund deployment/migration and detailed device acceptance matrix. The unresolved items in this lifecycle report remain open despite passing automated tests.
