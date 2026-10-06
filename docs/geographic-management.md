# Geographic management ? first release

## Available workflow

1. Sign in as an existing global super admin and open EventMDB ? Locations & Markets.
2. Create countries, then optional subdivisions, cities, districts and local areas. Codes are stable unique internal codes; country codes such as NG and GH are recommended. No country list or political boundaries are guessed or seeded.
3. In Regional records, select Unassigned records only, then assign each event/venue to a reviewed operating location. Clearing or changing an address removes its assignment. Assignment changes are audited and use optimistic concurrency.
4. In Staff & Role Management, assign worldwide access explicitly or pair regional roles with locations. Each grant can include descendants and an expiry. No assignments means no regional records. Regional managers can edit settings and unlist listings; moderators can unlist; viewers can read. Global staff administration stays with global super admins.
5. Select a location in the regional workspace to inspect effective settings, override individual values, reset inheritance, or lock a value for descendants. Global defaults are editable only by a global super admin.

## Rollout and compatibility

Existing super admins with no geographicAccess field retain worldwide access as a bootstrap compatibility exception. Other legacy staff fail closed until assigned. New invitations default to zero assignments, including super-admin invitations. A legacy accessScope.regions string, event ID, department, page override or token role does not grant geographic access. Access expiry, suspension, account status and roles are checked against Staff on every management request. No database migration or bulk backfill runs automatically.

The location selector applies only to the regional workspace. It does not claim to filter existing worldwide dashboards. Regional staff and staff with data restrictions are denied all legacy management modules. Existing global dashboards remain available to explicitly global staff according to existing role rules; legacy global modules still require a separate fine-grained action-permission audit. Staff and global-settings endpoints additionally require a global super admin.

Regional records expose an allowlist of listing name, status, schedule, location and timestamps. They exclude customer accounts, payment information, private venue calendars and identity documents. Bookings, payouts, refunds, KYC, exports, cross-country analytics and staff delegation are not yet available regionally. Extending each module requires server-side geographic queries, field-level permissions and regression tests before adding it to the boundary allowlist.

## Settings behavior

The initial regional catalog is support email/phone, event timezone/currency defaults, on-site event ticket availability and maximum event tickets per order. Resolution is global ? ancestor locations ? selected location. A parent lock wins even over a previously stored child override. Settings use revision checks to prevent lost updates. Runtime event validation, ticket editing and new event booking limits resolve the event's reviewed managementLocation. Support contacts are exposed in the regional settings response; consumer-app support UI is not wired yet. Unassigned new event creation uses global defaults. Existing event timezone/currency and historical transaction totals are not rewritten.

The global event-settings editor remains the source of base defaults. Overrides in Locations & Markets take precedence for this catalog. Regional venue booking policies, currencies/payment provider activation, localization, timezone selection in consumer apps, custom territory groups, geographic datasets and automatic address matching are outside this release.

## Data and security

GeographicLocation stores parent and ancestor IDs; parents are immutable to avoid silently changing access. An inactive ancestor disables regional access throughout its branch. managementLocation on events/venues references the reviewed location. Never delete referenced locations; deactivate them. Public API request bodies cannot set managementLocation. MongoDB indexes cover ancestor lookup and listing location/date queries.

Staff.grants bind location, role, descendant coverage and expiration in one record. Permissions are never combined across locations. RegionalSettings stores overrides and locks per scope, with revision numbers. AdminAuditLog records location creation/status changes, record assignment, unlisting and settings updates; staff profile audits include geographic access changes.

## Verification

Run `node --test tests/geography.unit.spec.cjs tests/geography.http.spec.cjs` in server. HTTP tests mount the real auth middleware, boundary and geography router with stubbed model storage, and use signed JWTs; they do not connect to the application database. Run `npm run build` and `npm run typecheck` in eventmdb. A staging MongoDB/browser smoke test is still recommended before deployment.
