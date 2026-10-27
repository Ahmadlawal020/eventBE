const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const Invitation = require("../../models/client/coOrganiserInvitation.schema");
async function save(req, res) {
  const { id, performerId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id) || (performerId && !mongoose.Types.ObjectId.isValid(performerId))) return res.status(400).json({ message: "Invalid event or performer ID." });
  try {
    const event = await Event.findById(id).select("createdBy performers status").lean();
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (String(event.createdBy) !== String(req.user.id)) {
      const access = await Invitation.findOne({ coOrganiser: req.user.id, host: event.createdBy, status: "ACCEPTED", "listings.listingId": id, permissions: { $in: ["MANAGE_LISTING", "ALL_ACCESS"] } }).lean();
      if (!access) return res.status(403).json({ message: "You do not have permission to manage this listing." });
    }
    if (event.status === "CANCELLED") return res.status(409).json({ message: "You can't update this field because the event has been cancelled." });
    const payload = {};
    for (const field of ["name", "role", "bio", "image", "socialLinks"]) if (req.body[field] !== undefined) payload[field] = req.body[field];
    if (!performerId && (typeof payload.name !== "string" || !payload.name.trim())) return res.status(400).json({ message: "Performer name is required." });
    if (payload.name !== undefined && (typeof payload.name !== "string" || !payload.name.trim())) return res.status(400).json({ message: "Performer name is required." });
    if (payload.socialLinks !== undefined) {
      if (!Array.isArray(payload.socialLinks) || payload.socialLinks.length > 7) return res.status(400).json({ message: "Choose up to seven social links." });
      const seen = new Set();
      for (const link of payload.socialLinks) {
        let url;
        try { url = new URL(link.url); } catch { return res.status(400).json({ message: "Enter a valid social link." }); }
        if (!["https:", "http:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password || seen.has(link.platform)) return res.status(400).json({ message: "Social links must be unique web addresses." });
        seen.add(link.platform);
      }
    }
    const performer = { ...payload, _id: performerId || new mongoose.Types.ObjectId() };
    const filter = performerId ? { _id: id, "performers._id": performerId } : { _id: id };
    const update = performerId ? { $set: Object.fromEntries(Object.entries(payload).map(([key, value]) => [`performers.$.${key}`, value])) } : { $push: { performers: performer } };
    const updated = payload.image ? await mongoose.connection.transaction(async session => {
      const locked = await Event.findOneAndUpdate({ _id: id }, { $inc: { saleVersion: 1 } }, { new: true, session });
      if (!locked) throw Object.assign(Error("Event not found."), { status: 404 });
      await require("../../services/eventMedia.service").attachMedia({ performers: [performer] }, locked, id, req.user.id, session);
      return Event.findOneAndUpdate(filter, update, { new: true, runValidators: true, session });
    }) : await Event.findOneAndUpdate(filter, update, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: "Performer not found." });
    return res.status(performerId ? 200 : 201).json({ success: true, data: updated.performers.id(performer._id) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ message: "Check the performer details: name and role allow 100 characters, bio allows 500, and social links must use a supported platform." });
    console.error("[SAVE PERFORMER]", error);
    return res.status(500).json({ message: "Could not save performer." });
  }
}
module.exports = { save };
