// Read compatibility for retired organiser holds; converted manual bookings have no holdId.
function withoutRetiredVenueHolds(document) {
  const venue = document.toObject ? document.toObject() : { ...document };
  if (venue.availability) {
    venue.availability = { ...venue.availability };
    for (const field of ["unavailableDates", "unavailableSlots"])
      venue.availability[field] = (venue.availability[field] || []).filter(entry => !entry.holdId);
  }
  return venue;
}
// Public venue responses must never contain guest records or internal operations data.
function publicVenue(document) {
  const venue = withoutRetiredVenueHolds(document);
  const { staff, coOrganisers, moderation, performance, managementLocation, bookingVersion, archivedAt, ...result } = venue;
  if (result.createdBy && typeof result.createdBy === "object" && ("email" in result.createdBy || "firstName" in result.createdBy)) {
    const { email, ...owner } = result.createdBy;
    result.createdBy = owner;
  }
  if (venue.availability) {
    result.availability = { ...venue.availability };
    for (const field of ["unavailableDates", "unavailableSlots"]) {
      result.availability[field] = (venue.availability[field] || []).map(entry => ({
        date: entry.date, type: "BLOCKED",
        ...(entry.startTime ? { startTime: entry.startTime } : {}),
        ...(entry.endTime ? { endTime: entry.endTime } : {}),
      }));
    }
  }
  return result;
}
async function canReadPrivateVenue(venue, user) {
  if (!user?.id) return false;
  const owner = venue.createdBy?._id || venue.createdBy;
  if (String(owner) === String(user.id)) return true;
  const scope = { status: "ACCEPTED", "listings.listingId": venue._id,
    permissions: { $in: ["ALL_ACCESS", "MANAGE_LISTING", "MANAGE_CALENDAR", "VIEW_CALENDAR", "MANAGE_BOOKINGS"] } };
  const co = await require("../models/client/coOrganiserInvitation.schema").exists({ ...scope, host: owner, coOrganiser: user.id });
  if (co) return true;
  return !!await require("../models/client/staffInvitation.schema").exists({ ...scope, organiser: owner, staff: user.id });
}
module.exports = { publicVenue, canReadPrivateVenue, withoutRetiredVenueHolds };
