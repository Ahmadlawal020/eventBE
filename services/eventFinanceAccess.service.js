const Event = require("../models/client/event.schema");
const Invitations = require("../models/client/coOrganiserInvitation.schema");
async function financialEvents(userId) {
  const [events, invitations] = await Promise.all([
    Event.find({ $or: [{ createdBy: userId }, { coOrganisers: userId }] }).select("_id title createdBy").lean(),
    Invitations.find({ coOrganiser: userId, status: "ACCEPTED",
      permissions: { $in: ["VIEW_FINANCES", "ALL_ACCESS"] } }).select("host listings").lean(),
  ]);
  return events.filter(event => String(event.createdBy) === String(userId) || invitations.some(invite =>
    String(invite.host) === String(event.createdBy) && invite.listings.some(listing =>
      listing.listingType === "Event" && String(listing.listingId) === String(event._id))));
}
module.exports = { financialEvents };
