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

- Payment completion now serializes with event cancellation. A late successful callback records a refund instead of issuing tickets. Repeated callbacks do not duplicate obligations. A missing event is flagged for payment resolution.
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
