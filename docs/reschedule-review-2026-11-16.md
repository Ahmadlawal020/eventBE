# Organiser and client rescheduling review ? 16 November 2026

Reviewed organiser manual bookings, organiser changes to platform bookings, and client venue rescheduling from Tickets.

## Corrections made

- Manual booking financial summaries include the full lower-price refund due before installments are approved, without counting approved amounts twice.
- A client's earlier unresolved Paystack return remains visible alongside a later checkout or after a later change completes.
- Client balances refresh while direct payments or refunds are due. Unrelated refund controls are hidden.
- Refunds requiring a receipt reference cannot be marked sent from the UI without it.
- Calendar availability polling stops during checkout rather than displaying a misleading eligibility error.
- Automatic-change audit entries describe Paystack collection correctly.
- Refund bank-detail changes cannot invalidate the frozen financial revision during an active reschedule checkout.

## Verified behavior

- Manual partial deposits and later collections are retained for daily and hourly moves, including higher, equal and lower totals.
- Original duration is preserved. Organiser availability exceptions require reviewed acceptance; actual booking conflicts remain blocked. Client availability rules remain strict.
- Approval requests keep original dates; accept, decline, withdrawal, conflicts and competing updates are covered by existing integration tests.
- Repeated automatic increases retain previous fees and charge a fee only on the new increase. A subsequent organiser move uses the same payment ledger.
- Original charges remain immutable. Cancellation refunds exclude platform fees and account for additional collections and refunds already sent.
- Repeated payment callbacks are idempotent. Expired payments, late success, provider outages and returns preserve the original booking.
- Customer ownership and organiser finance permissions are enforced; stale quotes and concurrent ledger updates cannot overwrite newer data.

## Verification and limits

Server unit suite: 300 passed. Combined booking operations, organiser reschedule, client reschedule and approval integration suite: 66 passed. App suite: 328 passed before the final display tests; all 16 targeted payment/refund display tests passed afterward. TypeScript passed after the final UI edits. A final client integration run covers the refund-detail checkout guard.

Gateway operations are mocked and MongoDB tests are isolated. No live financial transactions, production database changes, deployment, or physical-device walkthrough were performed. Follow client-venue-rescheduling.md for API/worker/index rollout and Paystack device testing, including closing and reopening the app.
