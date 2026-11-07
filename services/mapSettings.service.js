const { createHash } = require("node:crypto");

// Google browser keys are public credentials; restrict them to the map host in Google Cloud.
function validateMapSettings(update, previous = {}) {
  if (update.mapProvider !== undefined && !["leaflet", "google"].includes(update.mapProvider)) {
    return "Choose Leaflet or Google Maps.";
  }
  for (const [field, label, max] of [
    ["googleMapsApiKey", "Google Maps API key", 200],
    ["googleMapsMapId", "Google Maps map ID", 100],
  ]) {
    if (update[field] === undefined) continue;
    if (typeof update[field] !== "string") return label + " must be text.";
    update[field] = update[field].trim();
    if (update[field].length > max || (update[field] && !/^[A-Za-z0-9_-]+$/.test(update[field]))) {
      return label + " contains invalid characters or is too long.";
    }
  }
  const provider = update.mapProvider ?? previous?.mapProvider ?? "leaflet";
  const key = update.googleMapsApiKey ?? previous?.googleMapsApiKey;
  const mapId = update.googleMapsMapId ?? previous?.googleMapsMapId;
  if (provider === "google" && (!key || !mapId)) {
    return "Add a Google Maps API key and JavaScript map ID before enabling Google Maps.";
  }
  return null;
}

function publicMapConfig(settings) {
  const mapProvider = settings?.mapProvider === "google" && settings.googleMapsApiKey && settings.googleMapsMapId ? "google" : "leaflet";
  return {
    mapProvider,
    // Reads and unrelated platform updates must not reload a map someone is using.
    // Only the active Google configuration determines the opaque document version.
    mapVersion: mapProvider === "google"
      ? createHash("sha256").update(JSON.stringify([settings.googleMapsApiKey, settings.googleMapsMapId])).digest("hex").slice(0, 24)
      : "default",
  };
}
module.exports = { validateMapSettings, publicMapConfig };
