# Event release gap fixes ? 26 October 2026

Implemented locally. Refund payments remain manual. No refunds, application records, indexes, or deployment were changed by this work.

## Code changes

- Finance summary and weekly trends use the same completed, non-cancelled, non-exception eligibility filter as ticket revenue. Closed and review transactions retain their history with accurate labels and colors.
- Event payments is reachable from Tickets even when no entry tickets exist. Buyer-scoped, paginated history keeps payment references, verification, review status, copied references, and an email-support action available after app restart or local recovery expiry.
- Recovery preserves payments requiring review, including a case raised between the status read and verification request.
- Staff event and venue results use the same large visual panels as organiser results. A failed check-in refreshes the result so concurrent entry is shown as already used.
- Organiser and staff verification include occurrence, expiry, hold, event availability, current ticket date, and admission eligibility.
- Mobile receipts and the event ticket modal suppress entry QR codes for used, held, expired, cancelled, or otherwise unavailable tickets. Receipt HTML escapes supplied text.
- Legacy refund counts appear in operations alerts and cause the readiness check to fail. Migration previews return a failure exit code when manual reconciliation is required.

## Validation

- Server unit suite: 219 tests.
- Isolated payment/scan/refund integration suite: 111 tests.
- Mobile unit and screen-flow suite: 58 tests.
- Mobile TypeScript and targeted lint checks.
- Backend syntax and diff whitespace checks.

Provider calls in integration tests are mocked. Test database writes use a temporary replica set. These checks do not establish real device camera behavior, actual provider delivery, external refund receipt, or peak-load capacity.

## Configured database: manual reconciliation still required

Read-only migration planning found four legacy records whose stored amounts differ from checkout-derived ticket totals:

- 6ac8f2d8c62c7354386f55e8
- 6ac8f2d9c62c7354386f55f3
- 6ac8f2dac62c7354386f5602
- 6ac8f2dbc62c7354386f560d

The records and amounts were preserved. Finance must reconcile the original checkout, intended refund obligation, recipient and any existing settlement evidence. A migration must not infer that money was sent, replace a recorded obligation with a different amount, or create another payment.

Use the read-only migration report before any later apply step:
`node scripts/migrateTicketRefunds.js`

The read-only readiness check is:
`node scripts/checkRefundReadiness.js --database`

Database transaction support and required unique indexes passed the earlier read-only check. External alert delivery has no configured webhook destination. No destination was invented or contacted. Admin operations alerts remain available; refund handling stays manual.

## Final readiness result

At the final check on 26 October 2026, all required event indexes and transaction support passed. The readiness command correctly returned a failing status for four legacy refunds, the missing external alert destination, and stale worker heartbeats. No local Node API process was running, so workers need a matching API restart and fresh successful runs before launch readiness can pass.

Final source validation passed: 219 server unit tests, 111 isolated integration tests, 58 mobile tests, mobile TypeScript, targeted lint with zero warnings/errors, backend syntax, and scoped diff whitespace checks.

Code fixes are complete locally. Outstanding operational decisions are manual reconciliation of the four amounts, starting the API/workers, and supplying an owned HTTPS alert webhook. No monetary or recipient decisions were inferred, and no running payment/notification worker was started during this repair.

## Follow-up security review - 27 October 2026

The second review found additional account-security and capacity gaps. Fixes and their regression coverage are recorded in [event-security-fixes-2026-10-27.md](event-security-fixes-2026-10-27.md). The earlier statement that code fixes were complete applied to the first review, not this subsequent security review.
