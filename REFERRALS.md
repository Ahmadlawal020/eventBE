# Referral management

Open /admin/referrals/ on the API server and sign in with an existing finance or full administrator account. This workspace contains the mobile app and backend; the page is hosted by the backend because no separate admin frontend was supplied.

## Rules
- Every user has a persistent unique code. Existing codes are retained.
- Signup always accepts an optional valid code. After signup, an unlinked account may apply one code until the management-configured deadline from account creation. Default: 14 days. Management can select days or weeks; zero means signup only.
- Management sets a commission percentage and earning duration in days, weeks, or calendar months. Calendar-month expiry clamps to the last day of shorter months. The existing 5%/90-day settings are imported as a baseline; nothing is hard-coded after initialization.
- Policies target the referrer earning commission, not the paying buyer. Individual overrides beat group overrides, which beat global defaults. Higher-priority groups win; ties use the most recently changed matching group, then a deterministic key.
- A global pause or end stops everyone. Start begins a new earning period from that action (or referral attribution, if later). Resume preserves the original start; pause does not extend expiry. End cannot resume; Start begins another period.
- Every policy change is an append-only revision with effective time, administrator, reason, and a version. Concurrent edits return a conflict instead of overwriting settings.
- New ticket commissions qualify at verified payment time. Review-mode venue commissions qualify only after both payment and acceptance. Provider payment dates are saved before referral processing, so delayed webhooks use the applicable earlier rate. Existing records without qualification timestamps retain their historical date fallback.
- The booking must have been created after attribution; applying a code does not claim earlier bookings.
- Missed earnings are evaluated using the policy revision effective when the transaction qualified, including past pause intervals and group membership.
- Changing a rate normally affects only future qualifying transactions. Existing completed earnings keep their recorded rate.
- Past earnings can be changed only through the separate preview/confirmation flow: select scope, date range, replacement rate, and reason. The preview lists count and total change and expires after 30 minutes. Applying it records the old/new values and administrator per earning. Repeating an application is idempotent; records changed or refunded after preview are skipped. Maximum 1000 entries per preview; use smaller ranges for larger adjustments.

## Accounting and recovery
ReferralEarning is the authoritative ledger; the legacy user counter is not used. Unique payment/source/referrer indexes prevent duplicate commission. Unpaid review bookings do not earn. Refunds/cancellations retain an audit record and are excluded from completed totals.

A recovery job starts with the server and scans bounded batches every minute, repairing missed records and missing codes. It does not send bulk notifications. Existing historical earnings without source bookings are preserved, including the NGN 6,000 explicitly retained in this development database.

No bank disbursement/withdrawal implementation is included.

## API
- GET /api/admin/referrals/policies
- PUT /api/admin/referrals/policies/:key (GLOBAL, GROUP:id, USER:id; expectedVersion required)
- POST /api/admin/referrals/groups
- GET /api/admin/referrals/users?q=... or ?ids=...
- POST /api/admin/referrals/adjustments/preview
- POST /api/admin/referrals/adjustments/:id/apply with confirm: true

Legacy platform-fee endpoints use the global policy for referral settings, preventing unversioned rate changes.

## Validation
- npm run test:referral:unit: policy precedence and calendar arithmetic.
- npm run test:referral:dev: integration tests using the configured development MongoDB connection, with a random isolated test database. Test records are removed afterwards; the empty database is retained if the account lacks permission to drop it. Set REFERRAL_TEST_DNS to a comma-separated resolver list only if needed.
- npm run test:referral: uses a temporary local MongoDB and may download its binary.

Shared native links use munasaba:///refer?code=CODE and require the app to be installed. Universal web links require separate domain association and website configuration.
