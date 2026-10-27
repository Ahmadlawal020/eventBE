const { randomUUID } = require("crypto");
const Media = require("../../models/client/eventMedia.schema");
const cloudinary = require("../../utils/cloudinary");
async function prepare(req, res) {
  try {
    const storage = cloudinary.config();
    if (!storage.cloud_name || !storage.api_key || !storage.api_secret)
      return res.status(503).json({ success: false, message: "Image storage is not configured." });
    const publicId = "event-media/" + req.user.id + "/" + randomUUID();
    await Media.create({ publicId, owner: req.user.id, expiresAt: new Date(Date.now() + 3600000),
      cleanupAfter: new Date(Date.now() + 86400000) });
    const parameters = { timestamp: Math.floor(Date.now() / 1000), public_id: publicId, overwrite: false, allowed_formats: "jpg,jpeg,png,webp" };
    res.json({ success: true, data: { cloudName: storage.cloud_name, apiKey: storage.api_key, parameters,
      signature: cloudinary.utils.api_sign_request(parameters, storage.api_secret) } });
  } catch { res.status(500).json({ success: false, message: "Could not prepare image upload." }); }
}
async function complete(req, res) {
  try {
    const publicId = req.body?.publicId;
    if (typeof publicId !== "string") return res.status(400).json({ message: "An upload ID is required." });
    const record = await Media.findOne({ publicId, owner: req.user.id, state: { $in: ["PENDING", "READY", "ATTACHED"] } });
    if (!record || (record.state === "PENDING" && record.expiresAt <= new Date()))
      return res.status(409).json({ message: "Upload expired or unavailable. Upload the image again." });
    if (record.url) return res.json({ success: true, data: { public_id: publicId, secure_url: record.url } });
    const asset = await cloudinary.api.resource(publicId, { resource_type: "image", type: "upload" });
    if (asset.public_id !== publicId || asset.resource_type !== "image" || asset.type !== "upload" ||
        !["jpg", "jpeg", "png", "webp"].includes(asset.format) || !Number.isFinite(asset.bytes) ||
        asset.bytes <= 0 || asset.bytes > 8 * 1024 * 1024 || typeof asset.secure_url !== "string" || !asset.secure_url.startsWith("https://"))
      return res.status(422).json({ message: "Choose a JPEG, PNG or WebP image under 8 MB." });
    const updated = await Media.findOneAndUpdate({ _id: record._id, state: "PENDING", expiresAt: { $gt: new Date() } },
      { $set: { state: "READY", url: asset.secure_url } }, { new: true });
    if (!updated) return res.status(409).json({ message: "Upload expired. Select the image again." });
    res.json({ success: true, data: { public_id: publicId, secure_url: updated.url } });
  } catch { res.status(502).json({ message: "Could not verify the image upload. Please retry." }); }
}
module.exports = { prepare, complete };
