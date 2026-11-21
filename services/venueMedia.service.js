const mongoose = require("mongoose");
const Venue = require("../models/client/eventCenter.schema");
const Media = require("../models/client/eventMedia.schema");
const { requireVenuePermission, fail } = require("./venueAccess.service");
async function attachVenueMedia(images, previous, venueId, actor, session) {
  for (const image of images || []) {
    if (previous?.images?.some(old => old.publicId === image.publicId && old.url === image.url)) continue;
    if (typeof image.url !== "string" || !image.url.startsWith("https://")) throw fail(400, "Upload the venue photo through the app.");
    const record = await Media.findOneAndUpdate({ publicId: image.publicId, url: image.url, eventId: null,
      $or: [{ state: "READY", owner: actor, eventCenterId: null }, { state: "ATTACHED", eventCenterId: venueId }] },
      { $set: { state: "ATTACHED", eventCenterId: venueId, cleanupAfter: new Date(Date.now() + 86400000) } }, { new: true, session });
    if (!record) throw fail(400, "This photo is not a verified upload for this venue. Upload it again.");
  }
}
async function changeImages(id, actor, { publicId, toPosition }, remove = false) {
  if (!mongoose.isValidObjectId(id) || typeof publicId !== "string" || !publicId.trim()) throw fail(400, "A valid venue and photo ID are required.");
  return mongoose.connection.transaction(async session => {
    const venue = await Venue.findById(id).session(session);
    await requireVenuePermission(actor, venue, ["MANAGE_LISTING"]);
    if (venue.archivedAt) throw fail(409, "Archived venues cannot be edited.");
    const images = venue.images.map(image => image.toObject()).sort((a, b) => a.position - b.position);
    const index = images.findIndex(image => image.publicId === publicId);
    if (index < 0) throw fail(404, "Photo not found in this venue.");
    if (!remove && (!Number.isInteger(toPosition) || toPosition < 0 || toPosition >= images.length)) throw fail(400, "Choose a valid photo position.");
    if (remove && venue.status === "LISTED") {
      const settings = await require("./eventCenterSettings.service").getEventCenterSettings();
      if (images.length <= settings.publishing.minimumImages) throw fail(409, "Add a replacement photo before removing this photo from a published venue.");
    }
    const [image] = images.splice(index, 1);
    if (!remove) images.splice(toPosition, 0, image);
    venue.images = images.map((item, position) => ({ ...item, position }));
    await venue.save({ session });
    // Verified uploads are removed by the existing retryable cleanup worker.
    // Legacy unsigned assets are detached only: ownership cannot safely be proven.
    if (remove) await Media.updateOne({ publicId, eventCenterId: venue._id, state: "ATTACHED" },
      { $set: { cleanupAfter: new Date() } }, { session });
    return Object.assign(venue.images, { updatedAt: venue.updatedAt });
  });
}
module.exports = { attachVenueMedia, changeImages };
