# Event flow and security repairs - 27 October 2026

Implemented locally following the second event-flow review. Manual refund settlement is unchanged. No deployment, provider transactions, notifications, application database edits, or index migrations were performed.

## Account protection

- OTP verification explicitly checks expiry, reserves a maximum of five attempts atomically, and consumes codes at the final action. Password-code preview remains available for the existing two-step mobile flow.
- Customer password reset consumes the code, changes the password, clears the refresh token, and increments the session version in one MongoDB transaction. A failed write rolls everything back.
- JWT middleware loads the current account on each authenticated request. Suspended/deleted users and revoked session versions are rejected. Roles come from the database rather than stale token claims. Admin accounts are checked in the separate Staff collection.
- Password and Google login, and refresh, reject suspended accounts. Password/email changes and suspension invalidate prior sessions. Admin password resets also revoke existing sessions.
- The mobile password-reset screen clears local authentication and asks the user to sign in again.
- Public OTP verification responses expose only verification flags and the user ID, not the full user record.
- Application limits protect login, signup, Google auth, code sending/checking, public quotes, checkout and transfer initiation. OTP attempt counts are database-backed. HTTP rate-limit counters are per API process; multiple instances need equivalent shared gateway limits. Proxy trust must match the deployment's actual proxy chain.

## Event flow

- Public quotes reject oversized/duplicate/invalid items before ticket queries, enforce per-order and per-tier limits, check sales windows, event eligibility and available capacity, and validate integer monetary amounts. Checkout remains the authoritative reservation.
- Transfer and undo-check-in reject missing/invalid/expired ticket validity, matching admission checks.
- Event capacity is enforced across ticket tiers inside the transaction holding the event write lock. Counts include current-occurrence issued tickets, held tickets and pending reservations. Expired reservations continue counting until reconciliation releases them. Previous occurrences do not consume new-occurrence capacity; honoured tickets do.
- Capacity edits cannot reduce capacity below issued/reserved places. A configured zero capacity prevents sales; an omitted capacity preserves the existing unspecified-capacity behavior. Ticket-tier stock limits still apply independently.

## Validation

- Server unit suite: 226 tests passed.
- Isolated payment/lifecycle/security integration suite: 122 tests passed. After final hardening, all 11 affected security/capacity integration tests passed again.
- Final focused unit checks: 22 tests passed. Mobile TypeScript and targeted ESLint passed; JavaScript syntax checks passed for 55 changed files, and diff whitespace checks passed.
- Regression coverage includes concurrent cross-tier reservation, expiry release, paid capacity, capacity edits, OTP replay/expiry/attempt exhaustion, transaction rollback, password reset and fresh login, suspended password/Google login, and separate admin JWT access.
- The integration database is a temporary local replica set. Provider and email delivery are not exercised against real accounts.

## Deployment and operational follow-up

Deploy matching API and mobile changes, then verify API/worker heartbeats. Existing accounts/tokens without a session version are treated as version zero until revoked, so deployment does not force an unrelated global logout.

OTP expiry is enforced in application queries. The existing delayed TTL cleanup is retained as housekeeping, so this fix requires no OTP index migration. Expired records cannot authenticate while awaiting cleanup.

The four legacy refund amount discrepancies and absent external alert destination recorded in event-release-gap-fixes-2026-10-26.md still need operator input. No amount, recipient or delivery endpoint was guessed. These code fixes do not establish real-device camera behavior, peak-load capacity or production configuration correctness.
