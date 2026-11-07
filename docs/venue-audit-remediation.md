# Event-centre audit remediation

Updated 31 October 2026. Changes are in the local working copies of `server`, `munasaba`, and `eventmdb`; they have not been deployed.

## Confirmed business rules

- One exclusive bookable space per listing.
- Online bookings collect the full amount at checkout. Review bookings then await host approval.
- Organiser-recorded offline bookings support deposits and balance collections.
- Cancellation refunds are manual: the customer supplies account details, the organiser transfers the money outside the app and records proof, and the customer confirms receipt. The app does not initiate that transfer.
- Automatic provider reversals remain for unsuccessful bookings, including declined, expired, withdrawn unapproved requests and payments that cannot secure a booking.

## Implemented fixes

| Area | Result | Main implementation |
| --- | --- | --- |
| Venue media | Owner/scoped listing permission checked before image changes; arbitrary storage IDs rejected; new images require verified signed uploads. Existing unsigned assets are detached without deleting unverified storage. | `services/venueMedia.service.js`, venue media routes and mobile upload component |
| Checkout reservation | Transaction reserves the exclusive venue before gateway initialization. Concurrent calendar edits and checkouts serialize against the venue. Payment completion replaces its own reservation once. | `services/venueCheckout.service.js`, `services/checkoutSafety.service.js` |
| Manual booking finances | Calendar-only staff cannot record opening collections or change agreed prices. Deposits are validated against total price. Later payments and refunds use the finance-authorized ledger. | `services/venueCalendarMutation.service.js`, `services/bookingOperations.service.js` |
| History integrity | Arbitrary client history creation is disabled. Manual calendar changes, booking history, opening ledger and notices commit together. | `controllers/client/bookingHistory.controller.js`, calendar mutation service |
| Scheduling rules | Manual bookings and holds use shared timing, preparation-buffer, operating-hour, duration and platform booking-window validation. Checkout no longer applies conflicting duplicate availability checks. | `services/venueBookingRules.service.js`, calendar mutation service |
| Checkout expiry | A minute worker reconciles expired payments, releases unsuccessful reservations and queues reversals for late payments. Ambiguous provider failures retain inventory and retry. | `jobs/venueCheckout.job.js` |
| Notifications | Booking/payment/approval/calendar events persist in an outbox. Inbox, push and email delivery progress are tracked separately; retries preserve completed channels. Notification taps open the relevant screen. | `services/venueBookingEvents.service.js`, `services/eventCenterRefundNotifications.service.js` |
| Manual booking terms | Original unit/currency and booking snapshots survive listing edits and calendar removal. Cancelled bookings no longer show a collectible balance. | `services/manualBookingRead.service.js`, booking operations schema |
| Refund tracking | Offline refunds have approval, sent and confirmed stages, linked-customer bank submission, locked payment details, authenticated receipt uploads and authorised short-lived proof viewing. Marking sent requires verified proof for that installment. Unattached uploads are cleaned up; referenced proof is retained. Direct online cancellation refunds support installments, private receipts and confirmation of the specific payment. Financial totals separate sent, confirmed and outstanding amounts. | `services/venueRefundInstallments.service.js`, booking operations service, refund screens |
| Archive safety | Outstanding manual installments, cancelled manual collection balances and held security deposits prevent archival; archived venues reject new manual financial operations and holds. | `services/venueLifecycle.service.js`, booking operations and hold services |
| Completion | Past paid venue bookings transition to COMPLETED once. A delayed organiser payout remains eligible after completion. | Checkout worker and `services/venuePayout.service.js` |
| Checkout messages | Upfront payment, review approval, temporary reservation expiry and failed-booking reversals are described correctly. Failed reservations are not presented as ordinary pending confirmation. Successful review checkout shows the server approval deadline. | Mobile booking and payment components |
| Admin data | Venue calendar uses real venue choices and payment-aware occupancy without duplicate online blocks. Reviews use persisted records and moderator actions. API errors no longer substitute sample calendar data. Calendar and reviews remain enabled; unfinished sample modules are hidden from navigation and blocked on direct URLs. | Admin calendar/review routes and controllers |

Additional connected workflows:

- Customers can request price-preserving date changes. The original reservation remains until an authorised organiser accepts and availability is checked again transactionally.
- Owners can share an expiring private code to link an offline booking to a consenting customer account. The customer sees dates, payment/refund state and can confirm a refund; private staff notes are excluded.
- Discovery filters accept venue dates and optional hourly times and use the shared checkout availability rules.
- Holders of completed paid online bookings can submit one verified review. Published reviews appear on the venue; authorised moderators can hide or flag them with an embedded audit trail.

## Local verification

All of the following passed:

- Server: `node --test --test-reporter=spec tests/*.unit.spec.cjs` - 86 tests (the corrected hold assertion passed on its targeted rerun).
- Server: `node --test --test-reporter=spec tests/*.integration.spec.cjs` - 61 reported tests, using temporary MongoDB replica sets.
- Mobile logic: bookingWindow, calendarBookingGrouping, upcomingBookings, listingForms, httpRetry and eventCenterTicketStatus - 70 tests.
- `npx tsc --noEmit --incremental false` in both `munasaba` and `eventmdb`.
- Git whitespace checks in all three repositories (existing line-ending notices only).

New regression coverage includes competing checkouts, transaction rollback, calendar-only payment rejection, immutable manual terms, hold conversion, duplicate payment delivery, late payment reversal, completion, refund installments, stale confirmation IDs, private receipt preservation, account linking and privacy, reschedule authorisation, review eligibility/uniqueness, media ownership, real admin occupancy, and notification channel retry.

No production records were modified. Payment-provider, storage, push and email delivery were not exercised against live services. External notification and private receipt storage calls in the regression tests are mocked.

## Release and verification boundaries

The existing architecture remains Express/Mongoose, Expo and the Vite admin application. Database transactions require a MongoDB replica set, as the existing booking flows already do. Release the backend and updated clients together: the venue media flow now requires signed upload registration, and partial refund confirmations carry a settlement identifier. Legacy full-refund confirmation remains compatible. Offline refund payment recording now requires preparation and uploaded proof; deploy the updated refund UI with this backend. Existing sent refunds can still be confirmed.

Staging still needs a device/browser walkthrough, provider test-mode checkout and webhook verification, signed image/receipt upload, actual email/push delivery and worker monitoring. These local tests do not certify external credentials, provider settlement or mobile rendering.

The work covers the audited event-centre booking paths and connected calendar/review screens. Unfinished admin modules are unavailable rather than simulated as working tools. This work does not implement those deferred modules or optional future reporting/channel integrations. No unrelated working-copy changes were reverted.
