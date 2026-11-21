const express = require("express");
const { randomBytes } = require("node:crypto");
const PlatformSettings = require("../../models/management/platformSettings.schema");
const { publicMapConfig } = require("../../services/mapSettings.service");
const { googleMapHtml } = require("../../services/googleMapHtml");
const { googlePlacesHtml } = require("../../services/googlePlacesHtml");
const defaultOrigins = require("../../config/allowedOrigins");
const router = express.Router();

router.get("/config", async (_req, res, next) => {
  try {
    const settings = await PlatformSettings.findOne({ key: "platform_settings" }).lean();
    res.set("Cache-Control", "no-store").json({ success: true, data: publicMapConfig(settings) });
  } catch (error) { next(error); }
});

router.get("/google", async (req, res, next) => {
  try {
    const settings = await PlatformSettings.findOne({ key: "platform_settings" }).lean();
    if (publicMapConfig(settings).mapProvider !== "google") {
      return res.status(503).type("text").send("Google Maps is not configured.");
    }
    const nonce = randomBytes(18).toString("base64");
    const origins = [...(process.env.NODE_ENV === "production" ? [] : defaultOrigins),
      ...(process.env.CORS_ALLOWED_ORIGINS || "").split(",")]
      .map(value => value.trim()).filter(value => /^https?:\/\/[^\s;]+$/.test(value));
    res.removeHeader("X-Frame-Options");
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'nonce-" + nonce + "' 'strict-dynamic' https: 'unsafe-eval' blob:",
        "style-src 'nonce-" + nonce + "' https://fonts.googleapis.com",
        "img-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com data:",
        "connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:",
        "font-src https://fonts.gstatic.com",
        "frame-src https://*.google.com",
        "worker-src blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'self' " + origins.join(" "),
      ].join("; "),
    });
    res.type("html").send((req.query.mode === "places" ? googlePlacesHtml : googleMapHtml)({
      apiKey: settings.googleMapsApiKey, mapId: settings.googleMapsMapId, nonce,
    }));
  } catch (error) { next(error); }
});
module.exports = router;
