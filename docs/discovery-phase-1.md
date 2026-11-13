# Discovery Phase 1

## Implemented

The public home feed uses `GET /api/discovery/home`. Explicit search and booking-date filters still use the existing `/api/listings` flow. Existing cards, navigation, wishlist state, authentication, payment verification and checkout remain the source of truth.

- Sections: interest-ranked or contextual upcoming events, more events, and separately ranked venues.
- Explicit event/venue interests and city/country preferences.
- Personalization is enabled by default for signed-in users, including those who skip interest selection. The signup screen has no activity toggle. Legacy disabled defaults upgrade on next preference/feed access with a fresh learning cutoff and revision; anonymous browsing remains untracked. Reset remains supported.
- Signed-in, opted-in recommendation exposures, clicks, foreground detail engagement (15 seconds), dismissals and server-confirmed saves.
- Exposure threshold: 50% visible for one second. Delivery is recorded separately from exposure.
- Batches of at most 30 events; deterministic request/type/item keys deduplicate retries. No client-declared saves, purchases or attendance.
- Initial category profile derived on demand from bounded evidence. No materialized profile or worker is needed yet.
- Purchases/registrations read from fulfilled EventBooking records; attendance from redeemed UserEventTicket ownership. Paid/cancelled conflicts do not count.
- Venue evidence requires confirmed/accepted bookings. Attendance is read separately from BookingAttendance, so NO_SHOW corrections remove attendance influence. Transferred venue bookings are conservatively excluded from learning.
- Wishlist state, counter and trusted save evidence commit together in a transaction. Removing a save removes its active affinity contribution.
- No inferred sensitive category affinities. Explicit choices are still honored.

## Storage and privacy

`discovery.schema.js` exports DiscoveryPreference, DiscoveryBehavior and DiscoveryRequest. Event, EventCenter and User schemas are unchanged.

Preference revisions serialize ingestion, reset and feed logging. Late batches cannot re-create erased history. Reset advances learnedSince so old orders cannot be silently re-imported. Explicit selected interests remain.

Source transaction reads are deliberately conservative: orders and venue bookings must have been created after learning began/reset; event redemption must occur after that cutoff. No historical bulk backfill runs. Existing saves before learning began are not inferred automatically.

Raw impressions expire after 30 days; other behavioral records after 180 days. Feed request attribution expires after 30 minutes. Expiration is enforced in queries, independently of asynchronous TTL cleanup. An active user profile considers at most 300 non-impression history rows and 100 records per transaction source, within 180 days. The Not interested action has been removed; historical dismissals do not hide listings or affect ranking.

Anonymous browsing is contextual only; it does not persist recommendation history or merge anonymous activity into accounts. The mobile telemetry queue is memory-only, bounded to 100 events, retained up to two minutes, retried at most three times, and cleared on identity/role change or reset. It never blocks navigation.

No raw search terms, GPS trails, private venue calendars, bank details or identity documents are collected. Device reverse-geocoding supplies a city/country context; saved preferred locations take precedence. Exact-distance support is request-scoped only and does not provide geographic candidate retrieval.

Support-managed account closure must purge all three discovery collections for the user after revoking account access; existing account closure remains a support workflow and is not changed here.

## Eligibility and ranking

Candidates are bounded to 100 upcoming/recent, 80 local and 80 category candidates per domain, deduplicated before ranking. Automatic location and signup preferences guide relevance without excluding other areas. Explicit city/country searches remain strict with escaped city matching. Case-insensitive city matching has query-plan limitations; validate plans on actual inventory.

Events must be LISTED, not moderation-blocked, upcoming, and have a valid schedule. Known age restrictions are checked at event date; unknown ages do not receive age-restricted recommendations. The upcoming feed intentionally excludes already-running events.

Online ticket options must satisfy their sales window, supported currency, quantity and minimum purchase quantity. Event capacity includes issued tickets and unreleased pending reservations, including expired holds pending reconciliation. Prices use eligible ticket options, with distinct donation/on-site/no-ticket labels. Already-owned current occurrences and managed listings are suppressed.

Venues must be LISTED, non-archived and support a usable day/hour base price in an enabled currency. Home has no requested dates and therefore says "Check availability for your dates"; it does not assert availability. Date-filtered search and checkout retain their existing authoritative availability/quote rules. Price is the advertised base unit rate, not a date-specific quote.

Publication/moderation is rechecked after retrieval. Inventory remains an advisory snapshot; checkout performs the existing transactional revalidation.

Initial weights: click 0.5, engaged 1.5, save 4, free registration 4, fulfilled paid order 6, confirmed venue booking 6, attendance 8. Impressions have zero affinity weight. Use only the strongest listing/occurrence/day signal, cap each listing at 8, decay with a 30-day half-life, and shrink score by evidence/(evidence+8). Event and venue category branches are separate.

Ranking uses affinity (60%), city/distance relevance (25%) and event timing (15%). These are experiment starting points, not calibrated probabilities. Events and venues share one descending relevance ranking, with stable ID tie-breaking and no type quotas or forced alternation. The response is a bounded first page of up to 24 eligible listings, not an infinite ranked cursor.

## Deployment

1. Use a MongoDB replica set (already required by existing payment transactions).
2. Before deploying the API/mobile integration, run from server:
   `node scripts/ensureDiscoveryIndexes.js`
   This explicitly creates unique, TTL and retrieval indexes. It does not drop indexes or mutate listing documents. Do not depend on production autoIndex.
3. Deploy backend before the mobile client.
4. In staging, inspect candidate query plans, cardinality and p95 latency against representative inventory. Bounded result counts do not guarantee bounded index scans.
5. Smoke-test logged-out home, post-signup Continue/Skip, ordinary-login bypass, city/interests, real exposure/detail tracking, save/remove, empty/error states, search with booking dates, account switching, and price labels on iOS/Android. Verify default activation and reset through API tests.
6. Keep existing organiser dashboard estimates separate from new telemetry; they are not recommendation measurements.

No production database, indexes, deployment or EAS update was performed while implementing this change.

## Validation

- Server policy tests: `node --test tests/discovery.unit.spec.cjs`.
- Isolated replica-set tests: `node --test tests/discovery.integration.spec.cjs`.
- Mobile telemetry tests: `node --test tests/discoveryTelemetry.spec.cjs`.
- Mobile typecheck: `npx tsc --noEmit`.

Integration tests disable runtime MongoDB downloads and use only a local cached MongoDB binary. They do not load application credentials. Coverage includes idempotency, expired attribution, forged authoritative signals, reset/ingestion races, confirmed purchases and attendance, venue review and attendance corrections, reservation-aware capacity, API authentication, unavailable inventory, and transaction rollback.

## Phase 2 boundaries

Deferred: persistent aggregated profiles, short/long-term branches, worker aggregation, durable anonymous sessions, search/filter/share taxonomy, canonical performer affinities, budgets and booking-task ranking, impression fatigue, snapshot pagination/cache, daily trustworthy popularity statistics, and server-linked conversion attribution/experiments. Collaborative filtering remains Phase 3.

Phase 1 deliberately reads current authoritative transaction state rather than duplicating every financial transition into a learning outbox. This handles reversals and attendance corrections on the next feed request. Materialize and reconcile that evidence only after measuring the read cost. No new external infrastructure or machine learning package is introduced.


### Signup and location compatibility
Discovery preferences appear on a dedicated screen only immediately after successful account creation (local or Google signup). Continue saves choices; Skip enters the app with default discovery. An ephemeral user-specific signup marker guards the route and is cleared on completion or ordinary login. The home feed no longer contains the preferences editor.

Country filters support older published listings whose country name is populated but country code is absent. A conflicting stored country code is never overridden by its country name. Automatic nearby context influences ranking across areas even when some local listings exist; explicit city/country searches remain strict.
