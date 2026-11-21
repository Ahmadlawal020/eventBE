const editable = new Set([
  "venueType", "yearEstablished", "totalArea", "hallType", "venueSetting", "venueName",
  "shortDescription", "description", "guestAccessDescription", "interactionDescription",
  "neighborhoodDescription", "transitDescription", "otherDetailsDescription", "oneLiner",
  "theSpace", "yourProperty", "guestAccess", "interaction", "neighborhood", "transit", "otherDetails",
  "location", "supportedEvents", "images", "amenities", "availability", "capacity", "bookingSettings",
  "basePrice", "weekendPrice", "venueRules", "customVenueRules", "safety",
  "safetyConsiderations", "checkIn", "checkOut", "loadingDockDetails", "handoverDetails",
  "cancellationPolicy", "status", "isDraft", "expectedUpdatedAt", "calendarChangeReason", "scheduleOverrideToken", "yourSpace", "arrivalGuide", "entry",
]);
const fail = message => Object.assign(new Error(message), { status: 400 });
function validateKeys(value) {
  if (!value || typeof value !== "object" || value instanceof Date) return;
  if (Array.isArray(value)) return value.forEach(validateKeys);
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("$") || key.includes(".") || ["__proto__", "prototype", "constructor"].includes(key))
      throw fail("Use ordinary nested listing fields.");
    validateKeys(child);
  }
}
function venueEditablePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fail("Invalid listing update.");
  for (const key of Object.keys(payload)) if (!editable.has(key)) throw fail("This listing field cannot be edited: " + key);
  validateKeys(payload);
  const { calendarChangeReason, scheduleOverrideToken, ...fields } = payload;
  if (scheduleOverrideToken !== undefined && (typeof scheduleOverrideToken !== "string" || !/^[a-f0-9]{64}$/.test(scheduleOverrideToken))) throw fail("Invalid availability confirmation. Review the dates again.");
  if (calendarChangeReason !== undefined && (typeof calendarChangeReason !== "string" || calendarChangeReason.length > 1000)) throw fail("Keep the calendar change reason under 1000 characters.");
  return fields;
}
module.exports = { venueEditablePayload };
