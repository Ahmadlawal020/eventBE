const EVENT_FIELDS = new Set([
  "title", "shortDescription", "description", "images", "highlights", "amenities",
  "eventType", "ageRestriction", "schedule", "location", "capacity", "safety",
  "safetyConsiderations", "ticketGuide", "arrivalGuide", "performers", "entry",
  "status", "isDraft",
]);
const VENUE_FIELDS = new Set([
  "venueType", "venueName", "shortDescription", "description", "supportedEvents",
  "amenities", "images", "availability", "capacity", "bookingSettings", "basePrice",
  "weekendPrice", "discounts", "venueRules", "customVenueRules", "safety",
  "safetyConsiderations", "location", "yearEstablished", "totalArea", "hallType",
  "venueSetting", "guestAccessDescription", "interactionDescription",
  "neighborhoodDescription", "transitDescription", "otherDetailsDescription",
  "oneLiner", "theSpace", "yourProperty", "guestAccess", "interaction",
  "neighborhood", "transit", "otherDetails", "checkIn", "checkOut",
  "loadingDockDetails", "handoverDetails", "status", "isDraft",
]);
function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
const isObject = (value) =>
  value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function checkKeys(value) {
  if (Array.isArray(value)) return value.forEach(checkKeys);
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith("$") || key.includes(".") ||
        ["__proto__", "constructor", "prototype"].includes(key)) {
      invalid("Use nested listing fields, without update operators or dotted keys.");
    }
    checkKeys(nested);
  }
}
// Objects merge recursively; arrays are explicit replacements.
function mergePatch(previous, patch) {
  const result = { ...(isObject(previous) ? previous : {}) };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isObject(value) ? mergePatch(result[key], value) : value;
  }
  return result;
}
function prepareListingPatch(body, allowed, previous) {
  if (!isObject(body)) invalid("A listing update must be an object.");
  checkKeys(body);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) invalid("This listing field cannot be edited: " + key);
  }
  if ("isDraft" in body && typeof body.isDraft !== "boolean") {
    invalid("isDraft must be a boolean.");
  }
  if ("status" in body &&
      !["IN_PROGRESS", "LISTED", "ACTION_REQUIRED", "UNLISTED"].includes(body.status)) {
    invalid("Invalid listing status.");
  }
  const merged = mergePatch(previous, body);
  return Object.fromEntries(Object.keys(body).map((key) => [key, merged[key]]));
}
module.exports = { EVENT_FIELDS, VENUE_FIELDS, prepareListingPatch };
