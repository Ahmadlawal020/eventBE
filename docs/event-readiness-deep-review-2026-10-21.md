# Event readiness: deeper review, 21 October 2026

> Follow-up, 22 October 2026: the nine code findings below have been addressed locally. See [fixes and rollout](event-readiness-fixes-2026-10-22.md). These sections preserve the original audit evidence.

Original verdict: not ready for production. This review adds six findings to the three previously identified issues. It does not claim an exhaustive absence of other defects. Application source was not changed during this review.

## New findings

1. HIGH - Payment replay changes cancellation refund eligibility. In services/checkoutSafety.service.js:161, the cancelled-event payment branch allocates refunds across all tickets even for an already-completed booking. Reproduction: pay for two tickets, redeem one, cancel; one refund exists. Replay the successful payment; two refunds exist, including the redeemed ticket. A normal webhook replay or buyer verification can trigger this. Previously staff-voided tickets are also not excluded by this allocation branch, creating a possible second refund obligation. Preserve completed cancellation decisions and distinguish genuinely late, previously unissued payments from replays.
2. HIGH - Paid event can return to draft without cancellation. controllers/client/event.controller.js accepts status IN_PROGRESS through the ordinary update route. Reproduction: purchase tickets, update status to IN_PROGRESS; update succeeds, admission closes, and no refund records are created. Guard state transitions after sales; use UNLISTED to stop discovery while preserving entry and the cancellation workflow to cancel.
3. HIGH - Transferred ticket exposes original purchaser details. controllers/client/userEventTicket.controller.js:getTicketDetails populates the full booking. Reproduction: change an issued ticket to a new holder, fetch details as that holder; the original buyer email and phone are returned in bookingId.guestDetails, together with order information. Use a ticket-specific response and expose purchaser booking data only to the purchaser or an explicitly authorised management role. Hidden checkout access-code fields remained hidden; this finding is about contact and order information.
4. MEDIUM - Server PDF export uses stale dates and misleading validity labels. controllers/client/ticketExport.controller.js reads eventSnapshot.schedule.startDate rather than validSchedule.from and always prints Your Entry Ticket / SCAN FOR ENTRY. It does not check ticket state. Rescheduled/carried-over tickets print their original date; cancelled/expired/redeemed tickets still look like valid entry documents. Scanner validation still prevents invalid admission. This is confirmed by code review, not PDF rendering/device testing.
5. HIGH - Booking creation has no retry identity. controllers/client/eventBooking.controller.js generates a new payment reference and reserves inventory on each request. The request and schema have no buyer-scoped idempotency key. A lost response followed by retry can create another free booking or another paid reservation. This does not mean one payment callback issues twice: callback idempotency is separately tested. Add a stable checkout-attempt key and safe recovery of the existing booking/payment initialisation. Confirmed by code review; transport-loss end-to-end testing remains outstanding.
6. MEDIUM - Published image requirements can be bypassed. controllers/client/event.controller.js:deleteEventImage removes the last image without applying publish requirements. Reproduction: delete the only image from a LISTED event; it remains LISTED with zero images. The generic payload validator also applies the maximum image count only when publishing is true, rather than every relevant image mutation. Apply content invariants consistently across published-event mutations.

## Previously identified issues still open

- HIGH: A paid ticket remains usable/transferrable during external settlement; subsequent approval can fail after money is sent. No dedicated settlement recovery/hold workflow connects this to cancellation obligations.
- MEDIUM: A rejected void review permanently prevents a later request because the ticket has one unique review record and only PENDING reviews are accepted. Reopening requires an audited history.
- MEDIUM: Worker heartbeats can remain healthy while the task makes no progress. Check run duration/last successful completion and configure external alert delivery.

## Evidence and limits

Four targeted reproductions ran against a temporary MongoDB replica set using the existing integration fixture: payment replay, paid-to-draft transition, transferred-holder contact exposure, and last-image deletion. All four confirmed the undesired behavior. No application database, external payments, email, or storage provider was used. These were in-memory test extensions; no regression test files were added yet.

The earlier 207 unit and 66 integration checks were successful but did not cover these cases. They were not all rerun during this read-only audit. Existing source changes were preserved.

Reviewed event routes/controllers, lifecycle and occurrence services, checkout reservation/completion, webhook and verification paths, transfer/entry interactions, ticket response/export, media mutation/validation, refund review and notification/worker paths, and selected mobile checkout/ticket displays. Early-entry timing remains deliberately deferred at the user's request.

Before production: resolve and regression-test the findings; verify deployed database topology/indexes/migrations, matching releases, provider callbacks and notification delivery, device behavior, operational alert ownership, backups, and concurrent checkout/scanning at expected peak load. See event-occurrence-release-fixes.md for the staging checklist. Its previous local-validation result is not production approval and is superseded by these additional findings.
