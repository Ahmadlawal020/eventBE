const { test } = require("node:test"), assert = require("node:assert/strict");
const { stableHttps, checkReleaseConfiguration } = require("../services/releaseConfiguration.service");
test("release endpoints reject tunnels, local networks, credentials and insecure URLs", () => {
  for (const url of ["", "http://api.company.com", "https://localhost", "https://127.0.0.1", "https://10.1.1.1", "https://a.ngrok-free.app", "https://user:pass@api.company.com", "https://api.company.com?token=secret"]) assert.equal(stableHttps(url), false, url);
  assert.equal(stableHttps("https://api.company.com/api"), true);
});
test("release gates require environment, secrets, matching API endpoints and alert delivery", () => {
  const data = { server: { NODE_ENV: "production", PAYMENT_SECRET_KEY: "sk_live_fixture", PAYMENT_PUBLIC_KEY: "pk_live_fixture",
    ACCESS_TOKEN_SECRET: "a".repeat(64), REFRESH_TOKEN_SECRET: "b".repeat(64), QR_SIGNING_SECRET: "c".repeat(64),
    DATABASE_URI: "mongodb://configured", CLOUDINARY_CLOUD_NAME: "configured", CLOUDINARY_API_KEY: "configured", CLOUDINARY_API_SECRET: "configured",
    RESEND_API_KEY: "configured", EMAIL_FROM: "test@company.com", CORS_ALLOWED_ORIGINS: "https://admin.company.com", EVENT_ALERT_WEBHOOK_URL: "https://alerts.company.com/events" },
    mobile: { EXPO_PUBLIC_API_URL: "https://api.company.com/api" }, admin: { VITE_API_URL: "https://api.company.com/api" } };
  assert.deepEqual(checkReleaseConfiguration(data), []);
  assert.ok(checkReleaseConfiguration(data, "staging").some(e => e.includes("test mode")));
  data.server.EVENT_ALERT_WEBHOOK_URL = ""; data.admin.VITE_API_URL = "https://wrong.company.com/api";
  assert.equal(checkReleaseConfiguration(data).length, 2);
});
