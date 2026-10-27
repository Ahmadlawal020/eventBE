const mongoose = require("mongoose");
const Media = require("../models/client/eventMedia.schema");
const Event = require("../models/client/event.schema");
const UserTicket = require("../models/client/userEventTicket.schema");
const cloudinary = require("../utils/cloudinary");
const fail = message => Object.assign(Error(message), { status: 400 });
async function attachMedia(patch, previous, eventId, actor, session) {
  const images = patch.images || [], performers = patch.performers || [];
  for (const image of images) {
    if (previous?.images?.some(old => old.publicId === image.publicId && old.url === image.url) &&
        !String(image.publicId).startsWith("event-media/")) continue;
    await claim({ publicId: image.publicId, url: image.url }, eventId, actor, session);
  }
  for (const performer of performers) {
    if (!performer.image) continue;
    const oldImage = previous?.performers?.some(old => String(old._id) === String(performer._id) && old.image === performer.image);
    if (oldImage && !performer.image.includes("/event-media/")) continue;
    await claim({ url: performer.image }, eventId, actor, session);
  }
}
async function claim(asset, eventId, actor, session) {
  if (typeof asset.url !== "string" || !asset.url.startsWith("https://")) throw fail("Upload this image through the app before saving.");
  const record = await Media.findOneAndUpdate({
    ...asset, state: { $in: ["READY", "ATTACHED"] },
    $or: [{ state: "READY", owner: actor }, { state: "ATTACHED", eventId }],
  }, { $set: { state: "ATTACHED", eventId, cleanupAfter: new Date(Date.now() + 86400000) } }, { new: true, session });
  if (!record) throw fail("This image does not belong to this event or its upload has expired. Upload it again.");
}
async function cleanupEventMedia({ limit = 50 } = {}) {
  const candidates = await Media.find({ state: { $ne: "DELETED" }, cleanupAfter: { $lte: new Date() } })
    .sort({ cleanupAfter: 1 }).limit(limit).lean();
  let deleted = 0, retained = 0, failed = 0;
  for (const candidate of candidates) {
    try {
      const claimed = await mongoose.connection.transaction(async session => {
        const asset = await Media.findOneAndUpdate({ _id: candidate._id, state: { $ne: "DELETED" }, cleanupAfter: { $lte: new Date() } },
          { $set: { state: "CLEANING", cleanupAfter: new Date(Date.now() + 600000) } }, { new: true, session });
        if (!asset) return false;
        // Attachment writes this registry row too, so attachment and cleanup cannot both win.
        const eventUse = await Event.exists({ $or: [{ "images.publicId": asset.publicId }, ...(asset.url ? [{ "images.url": asset.url }, { "performers.image": asset.url }] : [])] }).session(session);
        const ticketUse = asset.url && await UserTicket.exists({ "eventSnapshot.coverImage": asset.url }).session(session);
        if (eventUse || ticketUse) {
          await Media.updateOne({ _id: asset._id }, { $set: { state: "ATTACHED", cleanupAfter: new Date(Date.now() + 86400000) } }, { session });
          retained++; return false;
        }
        return true;
      });
      if (!claimed) continue;
      const result = await cloudinary.uploader.destroy(candidate.publicId, { resource_type: "image", type: "upload", invalidate: true });
      if (!["ok", "not found"].includes(result?.result)) throw Error("Storage did not confirm deletion");
      await Media.updateOne({ _id: candidate._id, state: "CLEANING" }, { $set: { state: "DELETED", lastError: null } });
      deleted++;
    } catch (error) {
      failed++;
      await Media.updateOne({ _id: candidate._id }, { $set: { lastError: "Media cleanup failed", cleanupAfter: new Date(Date.now() + 3600000) } });
    }
  }
  return { deleted, retained, failed };
}
module.exports = { attachMedia, cleanupEventMedia };
