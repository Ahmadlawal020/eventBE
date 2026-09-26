# Payment checkout and review payouts

Event and venue checkout records are saved before Paystack initialization. Completion uses the saved buyer, amount, currency and reference, never payment metadata. The client resumes the returned access code. The generic payment initialization route is retired (410).

## Required deployment setup

- MongoDB must support transactions (Atlas, replica set or sharded cluster). A standalone MongoDB instance is insufficient. Booking, inventory, tickets and review payout creation use transactions.
- Build the VenuePayout unique indexes on booking and reference before enabling checkout. Keep the server cron process running: event reservation reconciliation runs every five minutes; venue payouts run every minute.
- Online checkout enables NGN by default. PAYSTACK_SUPPORTED_CURRENCIES can contain comma-separated enabled account currencies from NGN, USD, GHS, ZAR, KES. Only enable currencies supported by the actual Paystack account. Review payouts currently require NGN and a bank account.
- Review payments are initialized without a subaccount. Approval atomically confirms the booking and queues the saved organiser net amount. A Paystack transfer then sends that amount to the bank snapshot captured at checkout. Approval means queued, not bank delivery.
- Configure Paystack to retain enough balance for held payments and transfer fees; automatic settlement must not sweep funds needed by pending review bookings. Transfers must be enabled. OTP requirements can place payouts in NEEDS_ATTENTION. No Paystack account settings are changed by this code.
- Instant online bookings require the organiser subaccount. Standard split-payment charges use the saved platform fee.

## Reconciliation

Payout states are READY, SUBMITTING, PENDING, SUCCESS, FAILED and NEEDS_ATTENTION. After an ambiguous transfer response, the worker only verifies the same reference; it never blindly creates another transfer. Failed, rejected or OTP-protected transfers require operator review in Paystack. A crash between recording SUBMITTING and sending the request can also require operator reconciliation. Do not create another transfer without checking the deterministic reference.

Read payout records through GET /venue-payouts under the existing admin payments route, or GET /:id/payout under the client venue ticket route (restricted to the booking organiser). These endpoints exclude bank destinations. No payout management UI or automatic operator retry is added here.

Paid bookings with lost availability, and payments arriving after inventory expiry, are recorded with paymentResolutionRequired and no ticket issuance. Resolve these with the organiser. Existing automatic refund requests for declined or expired review bookings remain unchanged.

Card event inventory reservations expire after 30 minutes and a gateway check. Verification network errors keep inventory reserved. Free bookings create tickets in the reservation transaction. Existing manual transfer bookings do not use the card expiry clock.

Before rolling this change out, reconcile outstanding payments from the earlier metadata-only checkout: these may have no saved booking and are intentionally not fulfilled from metadata. Drain old active checkout sessions before deployment.

## Verification

Run npm run test:payments for the focused payment unit suite. It stubs models and gateway calls and does not load application credentials.

Run npm run test:payments:integration for real MongoDB transaction/concurrency checks. This suite creates its own temporary replica set and does not load application credentials or connect to the application database. It needs a mongodb-memory-server binary download or an existing compatible MONGOMS_SYSTEM_BINARY. The initial local run could not start because that download failed.

Use Paystack test mode and an actual mobile build to exercise success, cancel, already-paid verification, approval, decline, review expiry and transfer reconciliation before deployment. No live money movement has been tested.

Provider references: https://paystack.com/docs/payments/accept-payments/ and https://paystack.com/docs/transfers/single-transfers/.
