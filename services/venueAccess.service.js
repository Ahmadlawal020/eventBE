const Co = require("../models/client/coOrganiserInvitation.schema");
const Staff = require("../models/client/staffInvitation.schema");
async function hasVenuePermission(actor, venue, permissions) {
  if (!venue || !actor) return false;
  const owner = venue.createdBy?._id || venue.createdBy;
  if (String(owner) === String(actor)) return true;
  const scope = { status: "ACCEPTED", "listings.listingId": venue._id,
    permissions: { $in: [...permissions, "ALL_ACCESS"] } };
  const [co, staff] = await Promise.all([
    Co.exists({ ...scope, host: owner, coOrganiser: actor }),
    Staff.exists({ ...scope, organiser: owner, staff: actor }),
  ]);
  return Boolean(co || staff);
}
function fail(status, message) { return Object.assign(new Error(message), { status, statusCode: status }); }
async function requireVenuePermission(actor, venue, permissions) {
  if (!venue) throw fail(404, "Venue not found.");
  if (!await hasVenuePermission(actor, venue, permissions)) throw fail(403, "You do not have permission for this venue action.");
}
module.exports = { hasVenuePermission, requireVenuePermission, fail };
