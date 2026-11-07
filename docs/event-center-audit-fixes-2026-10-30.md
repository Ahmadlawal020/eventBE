# Event center audit fixes ? 30 October 2026

The event center booking/refund domain remains separate from events.

## Addressed findings
1. Guest booking detail responses serialize public venue fields and redact other guests' calendar contacts.
2. Listing updates use a server-side allowlist and reject ownership/internal fields, operator keys, and dotted paths.
3. Weekend pricing consistently means Saturday/Sunday. Guest and server quotes have regression coverage.
4. Hourly minimums apply per session day, with distinct weekday/weekend minimums. Unsupported per-event pricing is no longer offered and is rejected on price changes/publication.
5. Request-to-book explicitly collects payment upfront. Approval is bounded by the first booked start and 24 hours. Unapproved requests can be withdrawn by the guest for a full provider refund. Expiry workers handle legacy deadlines; acceptance rechecks inside the transaction.
6. The organiser booking workspace combines online and manual reservations, with one row per booking and cross-source pagination. Manual collections and booking snapshots survive calendar removal.
7. Management has independent Event Center Refunds pages, case assignment/notes/resolution, unpaid recovery, and worker monitoring/retries.
8. Booking and finance dashboards show gross collections, platform fees, refunds sent, confirmed receipt, outstanding refund liability, and net receipts per currency. Direct refunds reduce net receipts when marked sent, with confirmation tracked separately. Date-period summaries use booking creation dates and are restated for recorded refunds.

## Setup
The pricing/policy step now includes availability before pricing and a final review before publication. Opening hours, duration, preparation time, advance notice, booking horizon, approval and cancellation/refund terms are reviewable. API validation also protects published listings.

## Rollout
Deploy the server, mobile client and management client together. New management routes are generated locally. Keep the existing background workers running and use a MongoDB topology supporting transactions. This implementation does not alter production records, migrate historical refund collections, send money, or verify real provider/email delivery. Existing unsupported per-event listings must be edited to hourly or daily pricing before republishing.

## Verification
Use the venue/booking regression suites, mobile listing/booking suites, both TypeScript checks and the management production build. Integration tests use isolated temporary MongoDB databases and mocked provider calls. Device acceptance and live provider checks remain deployment tasks.

Final verification: the broader venue/security suite passed 104 tests, the selected mobile suite passed 69 tests, both applications passed TypeScript checks, targeted lint passed, and the management production build passed. No live payment, production data or device test was performed.
