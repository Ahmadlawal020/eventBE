# Cancellation and direct-refund audit

Reviewed 17 October 2026. This is a code and isolated-test review, not a guarantee about production data or external delivery.

## Expected cycle

1. Original organiser previews cancellation impact and confirms a message.
2. One MongoDB transaction cancels the event, invalidates unused tickets and pending transfers, creates one ticket-price refund per paid ticket for its current holder, and queues notices for original buyers and ticket holders.
3. The background worker persists an in-app notice and sends transactional email. Failed channels retry; successful channels are recorded. The cancellation response says queued, not delivered.
4. Current holders open the individual ticket and select Cancellation refund. Gift recipients submit their own bank details. The standalone refunds list redirects to Tickets.
5. The organiser pays outside Munasaba, uploads private image proof and marks the refund paid. Uploading proof alone does not mark it paid. Proof is locked after payment is recorded; bank details are locked after proof upload.
6. The buyer confirms actual receipt or disputes payment. A disputed refund can still be confirmed when money arrives. Confirmation closes the support case.
7. Overdue payment and overdue buyer confirmation are distinct situations; the hourly job preserves payment timestamps and queues reminders to both parties. It does not move money or automatically treat silence as confirmation.

## Gaps fixed during this review

- Payment completion now serializes with event cancellation. A late successful callback creates cancelled ticket records and per-ticket refunds, without issuing usable tickets. Repeated callbacks do not duplicate obligations. A missing event is flagged for payment resolution.
- Cancellation and refund notifications now have a durable database outbox; email-provider errors no longer silently lose notices.
- Cancelled events cannot be relisted by ordinary or stale editor requests or admin moderation. Only unused in-progress drafts can be deleted in a transaction, preserving purchased event records.
- Bank details have server validation and guarded edits. Refund mutations and their notification jobs commit together.
- Receipt replacement checks concurrent updates and cannot overwrite evidence already marked paid.
- Holders have refund access inside their tickets, notification routes back to Tickets, visible deadlines, retry states, confirmation prompt and cache refresh after disputes.
- Undoing check-in serializes with cancellation so it cannot revive a cancelled ticket.
- Immutable legacy item totals can supply ticket-price liability when booking-level subtotal is absent; invalid totals fail explicitly.

## Verification

Targeted Node tests cover policy validation, permissions, cancellation recipients, private receipts, listing filters, ticket dashboard states, payment validation, retry behavior and refund amounts. Isolated MongoDB replica-set tests cover payment/cancellation races, callback replay, full refund transitions, overdue reminders, undo-check-in races and rollback when notice persistence fails. No production database or payment provider is used; test email is stubbed. App TypeScript and targeted lint checks are also run.

## Deployment and live verification still required

- Deploy the new worker, outbox schema and indexes. MongoDB must support transactions. The process that loads server.js must stay running for the minute notification worker and hourly overdue worker.
- Verify configured email credentials and sender domain with test accounts. Provider acceptance is not proof of inbox delivery; bounces and spam filtering remain external. Retries use a stable provider idempotency key, but provider retention limits still apply.
- Verify an authenticated Cloudinary upload and signed receipt download on devices using the deployed credentials. Test current holder/organiser access and rejection for another account.
- Exercise the app on a device: cancel a test event with paid, free and transferred tickets; verify listings disappear, recipients see notices, current holders can submit details, organisers upload proof, and confirmation/dispute refresh correctly.
- Historical cancellations were not migrated. Audit existing cancelled events for missing refund records, missing notices and invalid/zero stored amounts before any repair. Use scripts/migrateTicketRefunds.js for a read-only report and --apply for transactional conversion with backups. Amount mismatches and payments recorded for a different recipient require manual review.
- Outbox errors are recorded as lastError with retry time and attempts; operational monitoring is needed. Current worker throughput is bounded to 25 notices per minute per process. Overdue processing handles 100 obligations per hourly run; large backlogs need increased capacity.
- Bank details are format-validated, not bank-verified. A receipt is evidence supplied by the organiser, not bank settlement verification. Support must handle non-payment, missing event records and disputes.
- Organiser-written policy text is descriptive. The implemented cancellation flow refunds ticket price only, excludes platform fees, and uses the selected cancellation deadline (default seven days); it does not execute arbitrary instructions in the policy text.

## Holder ownership update, 18 October 2026

Refunds are allocated per individual ticket using immutable checkout line totals. The `buyer` API field identifies the refund recipient for compatibility; `originalBuyer` preserves the purchase history. Ticket IDs match receipts, amounts and bank details to the correct holder. Pending transfers do not confer ownership; accepted transfers before cancellation do. Cancelled tickets cannot transfer.

Deploy the migration together with the server update: `node scripts/migrateTicketRefunds.js` reports and `node scripts/migrateTicketRefunds.js --apply` replaces the old one-per-booking unique index and converts eligible records. Originals are retained in `eventrefund_holder_migration_backups`. Records needing manual review cannot accept new payment details or be marked paid through the client. Existing paid refunds are never reassigned to a different person automatically.


## Production-readiness follow-up, 18 October 2026

Verdict: the normal flow and tested race protections pass, but this review does not approve a production rollout. No production database, email delivery or real payment was exercised.

### Fixed and verified

Mark-paid now atomically requires a ticket ObjectId, complete formatted bank details, a nonblank stored receipt ID and a real receipt date. Missing/null receipt dates cannot count as proof. An explicit null unpaid timestamp is accepted just like an absent timestamp. Concurrent submissions still create exactly one payment transition and notification.

Verification: 77 server unit/HTTP tests, 21 isolated MongoDB transaction tests and 5 refund workspace tests passed (103 total). Coverage includes cancellation rollback, late/replayed payments, transfer/cancellation races, free-ticket exclusion, holder permissions, receipt privacy, notification retries, disputes, confirmation and overdue reminders. New integration coverage removes each required bank/proof field, checks null receipt dates and races two mark-paid calls.

### Remaining release work

- High: recovery after incorrect bank details or proof. Bank details lock once proof is uploaded; proof locks once payment is marked. Management can assign/note/resolve cases but cannot safely reset these payment states. Define and implement an audited support correction workflow that preserves old evidence and prevents a second payment. Do not simply unlock paid records.
- High: overdue non-payment escalation. The holder can dispute a payment marked sent, but an unpaid overdue refund only displays contact-support guidance. Provide an actionable support route and an operational owner/response process. Closing a management case currently does not mean money was received.
- High: verify deployed transaction support, per-ticket unique indexes/migration, running workers, email delivery and authenticated receipt storage. Review unresolved historical migration records separately; their current production state was not queried in this audit.
- Medium: upload lifecycle. Preparing another upload replaces the pending asset ID; an abandoned upload or a completion race can leave an unreferenced private asset. Add persisted upload-attempt tracking, expiry, safe cleanup and upload rate limits. Cleanup must never remove attached payment evidence.
- Medium: capacity and observability. Delivery defaults to 25 notices/minute and overdue scanning to 100 records/hour. Load-test expected event size, monitor oldest pending notice/overdue obligation and retries, and alert on failures. Failed/deleted recipients currently retry indefinitely. Overdue scans do not isolate individual record failures, so a repeat failure can prevent later candidates being processed in that run.
- Medium: list scalability. Organiser and holder refund endpoints fetch entire result sets; the app downloads all event holders/refunds and filters locally. Add server pagination/search/summary aggregation before supporting large events.
- Device acceptance remains required: real receipt selection/upload/viewing, cancellation notices, transferred/free tickets, bank submission, stale/offline retry and cross-account rejection.

Product behavior to confirm before release: refunds cover ticket price only, not platform fees; organiser policy prose does not change the calculation. Direct payment is external and a receipt is not settlement verification. The system never automatically completes a refund merely because the holder does not respond.


## Implemented follow-up, 19 October 2026

The release-work items above describe the prior audit. The following code now addresses them:

- Holders can open a support request from an individual refund. Management has an open-request filter, the reason and an unpaid-recovery action. Recovery requires an open holder request plus explicit staff attestation that the organiser has not transferred money. It atomically preserves old bank details/proof in private recovery history, clears the editable account/proof, records an admin audit entry and queues both-party notices. Paid or confirmed refunds cannot be reopened. Staff must verify the external payment before using this action; the app cannot verify bank settlement.
- Direct upload preparation persists an upload attempt. Completion and attachment commit together and expired attempts cannot attach. The minute worker cleans abandoned assets after 24 hours, with retries, while preserving current receipts and archived recovery evidence. Historical orphan assets created before attempt tracking are not automatically swept.
- Receipt writes are limited to ten per authenticated account per minute per server process. Configure the gateway/shared limiter for a global limit when deploying multiple API instances.
- The monitored minute worker replaces the older hourly overdue schedule and notification-only worker. Each overdue record fails independently. Notification attempts stop after twelve failures or a permanent missing-recipient/address error. Management sees worker heartbeats, backlog age, failures and a controlled manual-retry action. Successful channels remain recorded on retry. Hook the structured REFUND OPERATIONS ALERT / FAILED logs into deployment alerting.
- Organiser pages use server summaries, paginated holders, literal-text search and refund filters. Holder details load 25 tickets per page, and the user app fetches refunds for only the selected ticket/refund. Legacy list endpoints remain available for old clients; deploy the new app to obtain bounded fetching.

### Deployment procedure

1. Deploy the server, app and EventMDB changes together. Keep a persistent process running server.js. It loads refundOperations.job on DB connection; do not separately schedule the old workers.
2. Ensure MongoDB replica-set or sharded transaction support. Create the declared upload-attempt, worker-health and ticket lookup indexes using the deployment's index-management procedure. Run the existing ticket-refund migration report and resolve legacy records before enabling affected accounts.
3. Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, RESEND_API_KEY and a verified EMAIL_FROM. Run `node scripts/checkRefundReadiness.js` for secret-free configuration flags. `node scripts/checkRefundReadiness.js --database` additionally reads transaction topology, refund indexes, legacy counts and worker health. It makes no repairs, provider requests or data writes.
4. Worker defaults: REFUND_NOTICE_BATCH=50, REFUND_NOTICE_DELAY_MS=600, REFUND_OVERDUE_BATCH=500, REFUND_CLEANUP_BATCH=100. Values are bounded; notification delay must stay within provider limits. The dashboard warns after 15 minutes of notice backlog and five minutes without worker completion. Tune using deployment measurements, not just local test timings.
5. Assign staff to check the open support queue and operational alerts. Corrections require external no-payment verification; case resolution alone is not payment confirmation. Monitor failed notices, provider errors and account deletions.
6. Complete the device acceptance matrix below using designated test accounts. Config flags and mocked tests do not establish provider delivery or real bank settlement.

### Live acceptance matrix (not executed by the coding agent)

- Cancel a test event containing paid, free and transferred tickets. Verify cancellation cannot be reversed, entry/transfer is disabled, and buyers plus current holders receive email/in-app notices. Free tickets must have no bank-details or payment action.
- Submit the current holder's account. Another user and the gift purchaser must not read/change that refund or view its receipt.
- Select/upload/view a real private receipt on Android and iOS. Mark sent, confirm receipt, and separately exercise dispute. Test losing the network before and after upload completion; retries must not duplicate payment transitions.
- Request support for wrong account details. Confirm no payment externally, reopen through management, verify old evidence remains stored and the holder can resubmit. Attempt recovery of a paid refund: it must fail.
- Stop/restart the worker in staging and verify backlog/heartbeat alerts and recovery. Simulate provider failure, then repair configuration and manually retry a failed notice. Verify no duplicate in-app notice.
- Load-test expected production event sizes and concurrent organisers against staging; isolated tests cover bounded results for 1,000 holders but are not a production capacity benchmark.

Final implementation verification: 79 server unit/HTTP tests, 29 isolated MongoDB transaction tests and 5 app refund workspace tests passed (113 total). Both app and management TypeScript checks passed. Local configuration flags are present for all six readiness variables; external credentials, delivery, deployment topology and real devices were not verified.
