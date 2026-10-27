# Event readiness fixes - 22 October 2026

Implemented locally, not deployed. This supersedes the open code findings in event-readiness-deep-review-2026-10-21.md; staging acceptance is still required.

## Changes

1. Completed payment replays after cancellation preserve the existing refund decision. They cannot create refund obligations for redeemed or staff-voided tickets. Truly late payments still create cancellation refunds transactionally.
2. Published events cannot return to draft through the general update endpoint. Organisers can unlist to stop sales or use the cancellation workflow.
3. Ticket detail responses return only the booking ID, without the original buyer's contact details or order data.
4. PDF exports use the ticket's current valid schedule. Expired, cancelled, redeemed and held tickets are marked as records not valid for entry and have no entry QR rendered.
5. Checkout requires a buyer-scoped idempotencyKey. Mobile stores the attempt across retries/restarts for the same cart. A partial unique database index enforces one booking per buyer and attempt. Replays return the existing free tickets or payment access details. Payment setup uses a lease and the original reference; uncertain results retain the attempt for safe retry/reconciliation. A provider success can be recovered after a lost response. Closing an acknowledged successful checkout clears the mobile attempt for a deliberate later purchase.
6. Published cover/minimum-image rules apply to removal and image updates, and maximum counts apply to image mutations. Image removal checks the event revision to reject concurrent changes.
7. Finance must place a paid ticket on settlement hold before sending money. The hold blocks scanning and transfers, cancels pending transfers, and prevents date changes. Pending review alone does not hold the ticket. Cancellation/completion preserve held tickets for finance; approval can record settlement afterward without a second cancellation refund. Releasing a hold requires explicit confirmation that no refund was sent. If the event was cancelled, release creates the normal cancellation obligation; if it ended, the ticket expires. All finance decisions and holder notices commit with an audit record. The system records external settlement; it does not independently verify or send the refund.
8. Rejected reviews can be requested again, preserving the prior decision and reopen history and refreshing the current holder details. Approval remains terminal.
9. Worker monitoring checks excessive runtime and missing recent successful completion in addition to heartbeats. A separate alert worker delivers configured HTTPS webhooks, suppresses unchanged repeats for 15 minutes, and reports delivery failure/missing configuration in the admin operations view.

## Validation

- 207 unit tests passed.
- 82 isolated replica-set integration tests passed, including 16 added regression tests.
- Admin/mobile TypeScript checks and the admin production build passed.
- Targeted lint passed with zero errors; mobile files report 19 warnings (unused imports/variables, hook dependencies and array notation).
- Backend diff whitespace and readiness-script syntax checks passed.
- Provider initialization, external alerts and email were mocked in tests. No real settlement, live-provider verification, production database change or deployment occurred.

## Deployment requirements

- Release matching mobile, API and admin versions. Old clients without checkout attempt IDs receive an actionable validation error; require the updated app before enabling this API release.
- Build and verify the partial unique EventBooking index on buyer + checkoutKey, with checkoutKey restricted to string values. Also verify EventMedia.publicId, TicketVoidReview.ticketId, RefundWorkerHealth.name and existing refund/payment/outbox indexes. Do not drop existing indexes blindly.
- Run the read-only node scripts/checkRefundReadiness.js --database in staging/target environment. It now reports event-specific indexes and worker alerts as well as refund checks. It does not create indexes or send alerts.
- Configure EVENT_ALERT_WEBHOOK_URL to an owned HTTPS monitoring endpoint. Optionally configure EVENT_ALERT_WEBHOOK_TOKEN for Bearer authentication. The JSON body contains service, alerts and at; redirects are disabled and requests time out after 10 seconds. No destination was invented or contacted during implementation. Confirm receipt and recovery messages in staging.
- Finance workflow: review -> hold -> verify external payment -> approve. Reject/release only after confirming no payment was sent. Old pending reviews must be prepared before settlement. Never release a hold when payment status is uncertain.
- Validate app restart/network-loss recovery, free/paid checkout, transfer denial during hold, cancellation/completion during settlement, reused-event expiry/carry-over, receipt/PDF dates, restricted staff permissions, actual provider callbacks and notifications on Android/iOS.
- Complete database migration/index checks, backup/restore and expected peak checkout/scanner load tests. Early-entry timing remains unchanged, as requested.
