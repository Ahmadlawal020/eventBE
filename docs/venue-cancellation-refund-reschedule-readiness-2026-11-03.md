# Venue cancellation, refund and reschedule readiness

Reviewed 3 November 2026. Verdict: **not ready for production deployment sign-off**. The reviewed code paths pass local regression checks after the repairs below. The configured database and local release environment still have operational blockers. These checks do not establish the state of a different hosting environment.

## Repaired in this review

| Finding | Repair | Evidence |
| --- | --- | --- |
| Cancelling the original booking left a reschedule request pending. | Both cancellation services now close the request in the booking transaction with a customer-visible explanation. Older cancelled bookings are reconciled when the request is read. Client cancellation invalidates the request cache. | New integration regression reproduced the pending state before repair and passed afterward. |
| Reschedule approval could ignore payment-resolution and refund-intent flags on an otherwise paid, active booking. | The shared quote/approval validator rejects unresolved payment or refund state before moving dates. | Regression covers both flags, rejected approval, and unchanged inventory. |
| A listed venue with archivedAt set could accept a new date-change request although approval rejected it. | Request creation and approval now use the same validator, including archive, price, duration, and booking-window checks. | Regression reproduced the accepted request before repair and now verifies rejection without replacing the prior request. |
| Removing Booking tools removed the organiser's manual refund entry point. | A dedicated Cancellation refund section supports approving cancelled manual-booking refunds and completing the existing private-proof/confirmation workflow. Booking tools, Payments, and Handover tabs remain removed. | Mobile regressions cover finance permissions, existing allocations, invalid/excessive amounts, and retry keys. |

## Verified behavior

- Competing checkout and reschedule approvals cannot reserve the same venue time twice. Original dates stay reserved until successful approval.
- Confirmed booking conflicts cancel pending reschedule requests immediately; unpaid checkout reservations continue blocking approval without cancelling the request.
- Declining an available request requires a customer-visible reason. Conflict declines describe the unavailable times.
- Concurrent cancellation produces one direct refund obligation. Cancellation, calendar release, audit and outbox changes roll back together on failure.
- Direct refunds exclude platform fees. Organisers send that money externally; account locking, private receipts, installment amounts and buyer confirmation are checked on the server.
- Automatic provider reversals remain separate from direct refunds. Tests cover ambiguous provider submission and reconciliation without a second blind refund submission.
- Tests cover ownership, immutable refund accounts, partial payments, stale confirmation IDs, retained receipt evidence and notification retries.

Validation: **81 server integration tests + 34 server unit tests + 14 mobile tests passed**. Mobile TypeScript and targeted ESLint passed. Git whitespace checks passed with existing line-ending warnings.

Server integration command:

```powershell
node --test --test-reporter=spec tests/venueRescheduleApproval.integration.spec.cjs tests/venueCancellation.integration.spec.cjs tests/venueLifecycle.integration.spec.cjs tests/venueRemediation.integration.spec.cjs
```

Server unit command:

```powershell
node --test --test-reporter=spec tests/venueCancellation.unit.spec.cjs tests/venueRescheduleAvailability.unit.spec.cjs tests/venueReschedulePolicy.unit.spec.cjs tests/venueRemediation.unit.spec.cjs tests/bookingOperations.unit.spec.cjs
```

Mobile command:

```powershell
node --test tests/manualBookingRefunds.spec.cjs tests/rescheduleReview.spec.cjs tests/venueRescheduleSelection.spec.cjs
```

## Remaining release blockers

1. `node scripts/checkReleaseReadiness.js` fails for the local configuration: server release mode, live payment keys, stable mobile/admin HTTPS API URLs, an owned HTTPS alert destination and exact HTTPS CORS origins are not configured for production. Do not replace development values merely to silence this check; supply the intended deployment values.
2. Read-only inspection of the configured database reports missing/stale checkout, payout, provider-refund, review-expiry and reminder worker heartbeats, plus stale refund notification/overdue/upload-cleanup workers. The oldest queued notice exceeds 15 minutes. Deploy and verify the dedicated worker and real alert delivery before launch.
3. Device and external-service acceptance remains unverified. Exercise guest and organiser cancellation, declined/withdrawn review-booking reversals, partial and final refunds, private receipt upload/viewing, interrupted network responses, competing hourly/day reschedules, notification navigation and provider test-mode reconciliation on the intended release environment.

The database supports transactions. All declared indexes checked for EventCenterBooking, EventCenterRefund, VenuePayout and EventCenterRefundOutbox exist, including checked unique and partial-index options. At inspection time there were zero expired-checkout backlog items, payment-resolution exceptions, reversal-attention items, payout-attention items and stalled payouts. This is a point-in-time result, not a worker-health guarantee.

No deployment, live payment/refund, notification delivery, production-key change or database repair was performed. Integration tests used isolated temporary replica sets and mocked external services. Existing unrelated working-copy changes were preserved.
