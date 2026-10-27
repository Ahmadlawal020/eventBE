# Event occurrence and release fixes ? 21 October 2026

Implemented locally; not deployed.

> Follow-up: [22 October fixes and rollout](event-readiness-fixes-2026-10-22.md) supersedes the descriptions below of paid-ticket void handling, external alert support, and validation totals.

## Ticket policy

- An ended event may be scheduled again under the same event ID. Each restart advances its occurrence number.
- Unused tickets expire by default. Entry closes at the event/ticket end even before the completion worker runs.
- In the organiser's Date & Time editor, **Honour previous unused tickets** is off by default. Explicit opt-in carries eligible unused tickets from the immediately previous occurrence to the new dates.
- Redeemed, staff-cancelled and event-cancelled tickets never carry over. Expired tickets left behind by an earlier occurrence cannot be revived by a later opt-in.
- Carry-over records previous occurrence dates and preserves the original purchase snapshot. Ticket cards, filters, details and printed receipt dates use the current valid schedule.
- Completion invalidates pending transfers. Scan, transfer and undo-check-in enforce occurrence/validity boundaries. Legacy tickets with expired original validity cannot enter an event merely because its dates were changed.
- Old pending payments cannot issue tickets for a newer occurrence; they enter payment resolution instead.
- Existing tier inventory and price history are preserved. Organisers must review ticket quantities and sales windows for the new occurrence; this update does not silently reset sold quantities or reopen closed sales windows.

## Other fixes

- Event schedule, unused-ticket validity, sales-window realignment and holder notices commit in one MongoDB transaction.
- Automatic verification-triggered publishing revalidates each event using current effective settings and a conditional update.
- Event purchase confirmations (paid and free) and organiser sale notices enter the durable outbox with issuance. Buyer notices retain quantity, amount, currency, reference, venue and event date. Provider delivery uses the existing retry worker.
- The admin Transaction ledger includes an event payment-exception queue. Finance users claim cases and can record an already-settled full external refund with reference, notes, explicit confirmation and an audit record. This action does not send money or independently verify settlement. Existing cancellation obligations must be handled in the cancellation workspace to avoid double refunds.
- Public event details no longer populate organiser/team email addresses.
- Reservation transactions recheck tier sales deadlines.
- npm test runs the actual Node unit suites; npm run test:integration runs isolated database suites.

## Validation

- 207 unit tests passed.
- 66 payment/lifecycle and media replica-set integration tests (64 in the main run plus two additional upload-verification tests) passed, including endpoint renewal, expiry/default/opt-in behavior, legacy validity, payment replay, rollback, publishing validation, privacy and finance permissions/audit.
- Admin production build and both admin/mobile TypeScript checks passed.
- Targeted lint passed for the admin operations screen and changed mobile upload, description, performer, validation and staff-ticket files.
- No application database, live payment provider or external settlement was used.

## Deployment and remaining acceptance

Deploy matching API, admin and mobile versions, with the notification and completion workers running on a transaction-capable MongoDB deployment. Existing missing occurrence fields are read as occurrence zero. Review historical events already reused before this rollout: their exact occurrence history cannot be reconstructed automatically from a missing occurrence field.

Verify deployed indexes, refund migration and worker health; perform device and provider smoke tests and peak gate/load tests. The code fixes below address the earlier audit items. External alert routing and the staging acceptance checklist remain outstanding. These local fixes are not full production sign-off.


## Follow-up fixes, 21 October

- Paid unused staff-ticket voids create a finance review and leave the ticket valid. Approval requires notes, a settlement reference and explicit attestation that the refund was already settled; the decision, invalidation and audit commit together. This does not initiate or independently verify a payment. Rejection leaves the ticket valid. Ownership, check-in and occurrence changes prevent stale approval.
- Event cancellation previews and refund creation include only unused tickets in the cancelled occurrence. Redeemed and expired prior-occurrence tickets receive no cancellation refund. Allocation preserves original per-ticket purchase amounts.
- Tier creation, updates and deletion serialize against event lifecycle changes. Concurrent tier creation rechecks the configured tier limit; transaction quantity limits are validated.
- Description creation and editing use the configured limits and preserve existing oversized text for correction.
- New event and performer images use signed, account-owned uploads verified against provider metadata before attachment. Cleanup deletes only registered orphan assets and retains event and ticket snapshot references. Legacy venue uploads are outside this change.
- Worker leases and heartbeats cover payment reconciliation, completion, refund operations and event-media cleanup. The finance ledger shows worker health, unresolved payment exceptions, cleanup failures and pending void reviews. Alerts are visible in the admin UI; no external paging destination has been configured.

## Staging acceptance checklist

1. Deploy matching API, admin and mobile builds to staging with an isolated transaction-capable database and provider test credentials. Verify unique indexes for EventMedia.publicId, TicketVoidReview.ticketId and RefundWorkerHealth.name, plus the existing payment/refund/outbox indexes. Apply the existing refund migration according to its runbook.
2. Confirm the completion, payment reconciliation, refund/notification and media-cleanup workers run and their health appears in the finance ledger. Assign an operations owner and connect monitoring to your chosen alert destination. Test worker stoppage and backlog visibility.
3. On physical Android and iOS devices, buy free and paid tickets, scan twice, transfer, complete an event and reschedule it. Check default expiry, explicit carry-over, and rejection of redeemed or cancelled tickets. Confirm old payment callbacks cannot issue new-occurrence tickets.
4. Exercise paid void requests with a finance test account. Verify rejection keeps tickets valid; approval requires an externally settled test refund reference and audit. Recheck tickets immediately before settlement because tickets remain usable while review is pending. If ownership, check-in or event status changes, stop and reconcile the case instead of recording stale approval.
5. Cancel an event containing unused, redeemed, transferred and prior-occurrence tickets. Compare the preview and created obligations with the unused current-occurrence tickets only. Verify notification retry and the existing refund workflow using provider test mode.
6. Test event/performer uploads with the actual configured Cloudinary account, interruption/retry, another account's upload ID, oversized images and cleanup. Confirm current and receipt snapshot images survive cleanup. Review legacy unsigned upload presets separately; venue uploads still depend on their current upload flow.
7. Run concurrent gate scans and checkout at the expected peak load. Confirm backup/restore, logs, production secrets and operational ownership before release. Review historical reused events whose occurrence history predates this rollout.

No production deployment, real-money settlement, live-provider verification or physical-device acceptance was performed during these local checks.
