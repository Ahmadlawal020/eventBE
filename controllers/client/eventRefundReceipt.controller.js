const mongoose = require("mongoose");
const EventRefund = require("../../models/client/eventRefund.schema");
const cloudinary = require("../../utils/cloudinary");
const MAX_BYTES = 5 * 1024 * 1024;

function decodeReceipt(value) {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw Object.assign(new Error("Choose a JPEG, PNG or WebP receipt under 5 MB."), { status: 400 });
  }
  const buffer = Buffer.from(value, "base64");
  let format;
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) format = "jpeg";
  else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) format = "png";
  else if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") format = "webp";
  if (!format || buffer.length > MAX_BYTES) throw Object.assign(new Error("Choose a JPEG, PNG or WebP receipt under 5 MB."), { status: 400 });
  return { format, data: `data:image/${format};base64,${value}` };
}

async function uploadReceipt(req, res) {
  let uploaded;
  let persisted = false;
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.refundId)) return res.status(400).json({ success: false, message: "Invalid refund ID." });
    // Receipts belong to the ticket holder assigned this refund.
    const filter = {
      _id: req.params.refundId, organiser: req.user.id, ticketId: { $exists: true },
      status: { $in: ["DUE_FROM_ORGANISER", "OVERDUE", "MARKED_PAID"] },
      "bankDetails.accountName": { $exists: true, $ne: "" },
    };
    const refund = await EventRefund.findOne(filter).select("+receipt.publicId");
    if (!refund) return res.status(404).json({ success: false, message: "Refund is not available for receipt upload." });
    if (refund.markedPaidAt && refund.receipt?.uploadedAt) return res.status(409).json({ success: false, message: "Payment proof cannot be replaced after the refund is marked paid." });
    const image = decodeReceipt(req.body);
    const storage = cloudinary.config();
    if (!storage.cloud_name || !storage.api_key || !storage.api_secret) {
      return res.status(503).json({ success: false, code: "RECEIPT_STORAGE_NOT_CONFIGURED",
        message: "Receipt uploads are unavailable because image storage is not configured on the server. Contact support." });
    }
    uploaded = await cloudinary.uploader.upload(image.data, {
      folder: "refund-receipts", type: "authenticated", resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp"],
    });
    const receipt = { publicId: uploaded.public_id, format: uploaded.format, uploadedAt: new Date() };
    const updated = await EventRefund.findOneAndUpdate({ ...filter, updatedAt: refund.updatedAt }, { $set: { receipt } }, { new: true, runValidators: true });
    if (!updated) throw Object.assign(new Error("Refund changed while uploading. Refresh and try again."), { status: 409 });
    persisted = true;
    if (refund.receipt?.publicId) {
      await cloudinary.uploader.destroy(refund.receipt.publicId, { type: "authenticated", resource_type: "image" })
        .catch((error) => console.error("[REFUND RECEIPT CLEANUP]", error.message));
    }
    return res.json({ success: true, data: { uploadedAt: receipt.uploadedAt } });
  } catch (error) {
    if (uploaded && !persisted) await cloudinary.uploader.destroy(uploaded.public_id, { type: "authenticated", resource_type: "image" }).catch(() => {});
    console.error("[REFUND RECEIPT UPLOAD]", error.message);
    if ([401, 403].includes(error.http_code)) return res.status(502).json({ success: false,
      code: "RECEIPT_STORAGE_AUTH_FAILED", message: "The image storage service rejected the server credentials. Contact support." });
    if (error.http_code === 400) return res.status(422).json({ success: false,
      message: "Image storage could not read this receipt. Try a JPEG or PNG screenshot of the receipt." });
    return res.status(error.status || 502).json({ success: false, message: error.status ? error.message : "The image storage service could not upload the receipt. Please try again." });
  }
}

async function getReceipt(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.refundId)) return res.status(400).json({ success: false, message: "Invalid refund ID." });
    const refund = await EventRefund.findOne({
      _id: req.params.refundId,
      $or: [{ buyer: req.user.id, ticketId: { $exists: true } }, { organiser: req.user.id }],
    }).select("+receipt.publicId").lean();
    if (!refund?.receipt?.publicId) return res.status(404).json({ success: false, message: "Receipt not found." });
    const url = cloudinary.utils.private_download_url(refund.receipt.publicId, refund.receipt.format, {
      type: "authenticated", resource_type: "image", attachment: false,
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: { url } });
  } catch (error) {
    console.error("[REFUND RECEIPT READ]", error.message);
    return res.status(500).json({ success: false, message: "Could not load receipt." });
  }
}
module.exports = { uploadReceipt, getReceipt, decodeReceipt };

// The app uploads the file directly, like listing media. Only this server signs
// private receipt uploads and verifies Cloudinary metadata before attaching them.
const editableReceipt = req => ({
  _id: req.params.refundId, organiser: req.user.id, ticketId: { $exists: true },
  status: { $in: ["DUE_FROM_ORGANISER", "OVERDUE", "MARKED_PAID"] },
  "bankDetails.accountName": { $exists: true, $ne: "" },
  $or: [{ markedPaidAt: { $exists: false } }, { "receipt.uploadedAt": { $exists: false } }],
});
async function prepareReceiptUpload(req, res) {
  try {
    const storage = cloudinary.config();
    if (!storage.cloud_name || !storage.api_key || !storage.api_secret) return res.status(503).json({
      success: false, code: "RECEIPT_STORAGE_NOT_CONFIGURED",
      message: "Private receipt uploads require Cloudinary credentials on the server. Contact support.",
    });
    const publicId = `refund-receipts/${req.params.refundId}/${require("crypto").randomUUID()}`;
    const refund = await EventRefund.findOneAndUpdate(editableReceipt(req),
      { $set: { pendingReceiptPublicId: publicId } }, { new: true });
    if (!refund) return res.status(409).json({ success: false, message: "This refund cannot accept a receipt. Refresh its payment status." });
    const parameters = { timestamp: Math.floor(Date.now() / 1000), public_id: publicId,
      type: "authenticated", overwrite: false, allowed_formats: "jpg,jpeg,png,webp" };
    const signature = cloudinary.utils.api_sign_request(parameters, storage.api_secret);
    return res.json({ success: true, data: { cloudName: storage.cloud_name, apiKey: storage.api_key, parameters, signature } });
  } catch (error) {
    console.error("[PREPARE REFUND RECEIPT]", error.message);
    return res.status(500).json({ success: false, message: "Could not prepare receipt upload." });
  }
}
async function completeReceiptUpload(req, res) {
  try {
    const publicId = req.body?.publicId;
    if (typeof publicId !== "string" || !publicId.startsWith(`refund-receipts/${req.params.refundId}/`)) return res.status(400).json({ success: false, message: "Invalid receipt upload." });
    // Repeating completion after a lost response is harmless.
    const existing = await EventRefund.findOne({ _id: req.params.refundId, organiser: req.user.id }).select("+receipt.publicId");
    if (existing?.receipt?.publicId === publicId) return res.json({ success: true, data: { uploadedAt: existing.receipt.uploadedAt } });
    const filter = { ...editableReceipt(req), pendingReceiptPublicId: publicId };
    const refund = await EventRefund.findOne(filter).select("+receipt.publicId");
    if (!refund) return res.status(409).json({ success: false, message: "Receipt upload expired or refund changed. Refresh and select the image again." });
    const asset = await cloudinary.api.resource(publicId, { resource_type: "image", type: "authenticated" });
    if (asset.type !== "authenticated" || asset.resource_type !== "image" ||
        !["jpg", "jpeg", "png", "webp"].includes(asset.format) || !Number.isFinite(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_BYTES) {
      await cloudinary.uploader.destroy(publicId, { type: "authenticated", resource_type: "image" });
      return res.status(422).json({ success: false, message: "Choose a JPEG, PNG or WebP receipt under 5 MB." });
    }
    const receipt = { publicId, format: asset.format, uploadedAt: new Date() };
    const updated = await EventRefund.findOneAndUpdate({ ...filter, updatedAt: refund.updatedAt },
      { $set: { receipt }, $unset: { pendingReceiptPublicId: 1 } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ success: false, message: "Refund changed while uploading. Refresh before trying again." });
    if (refund.receipt?.publicId) await cloudinary.uploader.destroy(refund.receipt.publicId,
      { type: "authenticated", resource_type: "image" }).catch(error => console.error("[REFUND RECEIPT CLEANUP]", error.message));
    return res.json({ success: true, data: { uploadedAt: receipt.uploadedAt } });
  } catch (error) {
    console.error("[COMPLETE REFUND RECEIPT]", error.message);
    return res.status(502).json({ success: false, message: "Could not verify the uploaded receipt. Try uploading again." });
  }
}
module.exports.prepareReceiptUpload = prepareReceiptUpload;
module.exports.completeReceiptUpload = completeReceiptUpload;
