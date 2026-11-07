# Map provider setup

EventMDB > Platform Configuration > Maps & Location controls maps throughout Munasaba.
Existing installations default to Leaflet (OpenStreetMap). Address search and reverse
geocoding continue to use Photon / the existing device geocoder with either provider.

## Enable Google Maps

1. In Google Cloud, enable billing and the **Maps JavaScript API**.
2. Create a browser API key. Apply **Websites** restrictions allowing the API server
   origin, e.g. `https://api.example.com/*`. Restrict the key to **Maps JavaScript API**.
   Google loads inside `/api/maps/google` on that host, including on Android and iOS.
   Include your development server origin when testing locally.
3. Create a **JavaScript** map ID. `DEMO_MAP_ID` is supported for testing only.
4. In EventMDB, enter the key and map ID, select **Google Maps**, and save.
5. Ensure `EXPO_PUBLIC_API_URL` points to this server's `/api` base URL.
   Include the web app's origin in server `CORS_ALLOWED_ORIGINS` (comma separated).
   This also allows the web app to embed the hosted map. Use HTTPS in production.
6. Open a location picker and a ticket map on web and mobile. Confirm rendering,
   pin placement, zoom, circles and retry. Switch back to Leaflet and confirm both.

Mounted maps refresh configuration every 60 seconds while active. New map screens
also refresh configuration. A failed config request keeps the last successful
choice, or defaults to Leaflet if no choice has been fetched yet.
Switching providers preserves coordinates and requires no database migration.
The server validates that both credentials exist before Google can be enabled;
Google verifies their validity when the map loads. API/billing/network failures
show the map error and retry UI. Select Leaflet in EventMDB to roll back.

Browser keys are visible in the hosted map by design; domain/API restrictions
must be configured in Google Cloud. Keys are omitted from public configuration
JSON and redacted in new audit entries. The map page is served with a nonce-based
CSP and an embedding allowlist; reverse proxies must not overwrite these headers
with `X-Frame-Options: SAMEORIGIN` or a conflicting CSP.

Official setup: https://developers.google.com/maps/documentation/javascript/advanced-markers/start
Key restrictions: https://developers.google.com/maps/api-security-best-practices
CSP: https://developers.google.com/maps/documentation/javascript/content-security-policy
