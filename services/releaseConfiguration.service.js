function stableHttps(value) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search &&
      host.includes(".") && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host) &&
      !/(^|\.)(localhost|local|test|invalid)$/.test(host) && !/ngrok|trycloudflare|loca\.lt/.test(host);
  } catch { return false; }
}
function checkReleaseConfiguration({ server = {}, mobile = {}, admin = {} }, target = "production") {
  const errors = [];
  if (!["production", "staging"].includes(target)) return ["Choose a production or staging release target."];
  if (server.NODE_ENV !== "production") errors.push("Server NODE_ENV must be production for a release.");
  const mode = target === "production" ? "live" : "test";
  if (!(server.PAYMENT_SECRET_KEY || "").startsWith("sk_" + mode + "_")) errors.push("Paystack secret key must use " + mode + " mode.");
  if (!(server.PAYMENT_PUBLIC_KEY || "").startsWith("pk_" + mode + "_")) errors.push("Paystack public key must use " + mode + " mode.");
  const secrets = ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET", "QR_SIGNING_SECRET"];
  for (const key of secrets) if (!server[key] || server[key].length < 32 || /your_|generate_|example/i.test(server[key])) errors.push(key + " must be a generated secret of at least 32 characters.");
  if (new Set(secrets.map(key => server[key])).size !== secrets.length) errors.push("Authentication and QR secrets must be distinct.");
  for (const key of ["DATABASE_URI", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "RESEND_API_KEY", "EMAIL_FROM"]) if (!server[key] || /your_|user:pass|example/i.test(server[key])) errors.push(key + " must be configured.");
  for (const [label, value] of [["EXPO_PUBLIC_API_URL", mobile.EXPO_PUBLIC_API_URL], ["VITE_API_URL", admin.VITE_API_URL], ["EVENT_ALERT_WEBHOOK_URL", server.EVENT_ALERT_WEBHOOK_URL]]) if (!stableHttps(value)) errors.push(label + " must use a stable public HTTPS URL.");
  const origins = (server.CORS_ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => !stableHttps(origin) || new URL(origin).origin !== origin)) errors.push("CORS_ALLOWED_ORIGINS must list exact public HTTPS origins, separated by commas.");
  if (stableHttps(mobile.EXPO_PUBLIC_API_URL) && stableHttps(admin.VITE_API_URL) && mobile.EXPO_PUBLIC_API_URL.replace(/\/$/, "") !== admin.VITE_API_URL.replace(/\/$/, "")) errors.push("Mobile and admin must target the same API release.");
  return errors;
}
module.exports = { stableHttps, checkReleaseConfiguration };
