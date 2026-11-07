# Venue and authentication fixes - 28 October 2026

## Changes by review finding

1. Public venue list/detail responses redact guest contact data, booking IDs, internal metadata and team contacts. Full venue details require ownership or a current accepted invitation with listing/calendar/booking read permission.
2. Local signup requires an email-bound, ten-minute, single-use verification proof. Only its SHA-256 digest is stored; proof consumption and account creation share a transaction. The mobile OTP screen passes this proof to signup. Google signup still requires its verified Google signup token; local signup cannot assign a Google subject ID.
3. Generic profile updates reject password/email changes. Dedicated OTP flows remain available. Changing a phone number resets its verification flags.
4. Rescheduling requires booking-management permission and writes inventory, booking and history atomically. Existing blocks, preparation time, operating hours, booking windows, duration and price are checked. Changes that alter the paid price/duration require cancellation and a new booking. Started sessions require support review.
5. Cancellation cancels a READY, unclaimed payout in the same transaction. PREPARING, submitted, pending or completed payouts prevent automatic cancellation and require support reconciliation. Payout workers check booking eligibility and use fenced leases before submitting transfers.
6. Cancellation/decline/review expiry atomically persist cancellation, release calendar blocks, append history and queue refund intent and buyer notification. The refund worker persists SUBMITTING before calling the provider, reconciles after restarts/timeouts, and marks REFUNDED only after the provider reports processed with matching amount/currency. Ambiguous results never cause another automatic refund POST. Late payments and paid availability conflicts also queue refund intent. Admin refund lists include pending work and details show provider IDs/errors.
7. Venue deletion now archives records. Outstanding platform bookings, refunds, payouts, future manual bookings and active holds block archival. Booking history and media references remain intact. Checkout writes the venue inside its transaction so archival cannot silently race with booking creation.
8. Buyer-controlled manual-transfer reservations are rejected. Online checkout remains available, including payment methods supported inside the provider checkout. Organisers can still record offline bookings using their management calendar.
9. Admin registration always uses current database permissions and session-version checks. Public empty-database bootstrap is removed. Client/admin access and refresh tokens have distinct account types, including legacy shared-ID seed accounts. CLI bootstrap requires explicit credentials, changes only Staff, revokes prior sessions, and neither creates fake KYC records nor prints passwords.
10. Event and venue forms preserve unsaved edits after failed saves, serialize submissions, save dirty fields across stages, preserve edits made during a pending request, and suppress late navigation after blur. Creation failures have a retry action. Saving edits does not demote published listings.
11. Mobile HTTP automatic retries are limited to GET/HEAD/OPTIONS. Mutations are not replayed after a timeout or lost response.

## Validation

- Server unit tests: 63 passed.
- Mobile tests: 74 passed (the 25 original listing-form failures are resolved).
- Auth and venue lifecycle integration suites: 19 passed, using disposable MongoDB replica sets and mocked payment-provider calls.
- Existing attendance/booking integration suites: 6 passed.
- Mobile and admin TypeScript checks passed.
- Admin production build passed.
- No live payments, emails, production database changes or deployment were performed.

## Deployment and existing data

Deploy the matching mobile/web signup client with the API; older clients lack signup proof. Existing tokens without an account type are rejected: users and administrators must sign in again. Use a MongoDB replica set, including for local development, because signup and booking changes now depend on transactions.

Start the API through server.js so the venue refund job is scheduled. Ensure indexes for SignupVerification.digest (unique), SignupVerification.expiresAt (TTL), and EventCenterBooking refund.state/refund.leaseUntil exist. Keep the notification outbox worker running. Monitor NEEDS_ATTENTION refunds and payouts in addition to failed jobs.

Run `node scripts/checkVenueAuthReadiness.js` against the intended deployment database to inventory legacy records. This script is read-only and was not run against application data during this task. Reconcile old cancelled/paid and previously REFUNDED bookings against provider records before creating any new refund request. Inspect pending bookings without checkout codes for legacy unpaid transfer reservations; do not assume every missing code is a transfer. Existing local-account verification flags predate enforceable proof and require a provenance/reverification decision before trusting them for publishing.

For new automatic refunds, NEEDS_ATTENTION is deliberately safe: investigate the payment reference in the provider dashboard. If a refund already exists, the worker will discover a single matching full refund or poll the saved provider ID. If no request was accepted, an operator may initiate the refund through the provider after confirming no duplicate exists; the worker then reconciles it. Multiple or partial refund records require manual reconciliation rather than a blind retry. Started/completed payouts require separate settlement review before cancellation; this change does not attempt to claw back transferred funds.

Bootstrap using `npm run create-admin` with ADMIN_EMAIL and ADMIN_PASSWORD supplied securely in the environment. The password must be at least 12 characters and at most 72 UTF-8 bytes. This command updates the named Staff account; it does not create a client account or identity-verification record.

Provider semantics were checked against the [Paystack Refund API](https://paystack.com/docs/api/refund/): creation can return pending, while fetch/list provide the eventual processed status.
