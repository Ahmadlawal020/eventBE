const crypto = require("crypto");

// ============================================================================
// QR PAYLOAD SIGNING — Single source of truth
//
// Fail-closed: server will not start if QR_SIGNING_SECRET is missing.
// ============================================================================

const QR_SECRET = process.env.QR_SIGNING_SECRET;

if (!QR_SECRET) {
  throw new Error(
    "FATAL: QR_SIGNING_SECRET is not set in environment variables. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

/**
 * Generate a cryptographically unique ticket number.
 * @param {"MNB"|"MNS"} prefix - MNB for events, MNS for venues
 * @returns {string} Format: PREFIX-XXXXXXXX-XXXX (16 hex chars = 8 bytes)
 */
function generateTicketNumber(prefix = "MNB") {
  const hex = crypto.randomBytes(8).toString("hex").toUpperCase();
  return `${prefix}-${hex.slice(0, 8)}-${hex.slice(8)}`;
}

/**
 * Generate a HMAC-signed QR payload for tamper-proof verification.
 * @param {string} ticketNumber
 * @param {string} entityId - event ID or event center ID
 * @param {"EVENT"|"EVENT_CENTER"} type
 * @returns {string} JSON string with embedded signature
 */
function generateQRPayload(ticketNumber, entityId, type) {
  const payload = {
    tn: ticketNumber,
    [type === "EVENT" ? "eid" : "ecid"]: entityId.toString(),
    ts: Date.now(),
    v: 1,
    type,
  };

  const dataString = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", QR_SECRET)
    .update(dataString)
    .digest("hex")
    .slice(0, 12);

  return JSON.stringify({ ...payload, sig: signature });
}

/**
 * Verify the HMAC signature of a scanned QR payload.
 * @param {string} qrString - JSON string from QR code
 * @returns {{ valid: boolean, data: object|null }}
 */
function verifyQRPayload(qrString) {
  try {
    const parsed = JSON.parse(qrString);
    const { sig, ...data } = parsed;

    const expectedSig = crypto
      .createHmac("sha256", QR_SECRET)
      .update(JSON.stringify(data))
      .digest("hex")
      .slice(0, 12);

    return { valid: sig === expectedSig, data: parsed };
  } catch {
    return { valid: false, data: null };
  }
}

module.exports = {
  generateTicketNumber,
  generateQRPayload,
  verifyQRPayload,
};
