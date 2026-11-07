const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
function config(env) {
  const context = { process: { env }, module: { exports: {} }, require: () => require("../config/allowedOrigins") };
  vm.runInNewContext(fs.readFileSync(require.resolve("../config/corsOptions"), "utf8"), context);
  return context.module.exports;
}
function allowed(options, origin) {
  let result; options.origin(origin, (error, accepted) => { result = !error && accepted === true; }); return result;
}
test("production CORS accepts configured origins and native clients but excludes development defaults", () => {
  const options = config({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://admin.company.com" });
  assert.equal(allowed(options, "https://admin.company.com"), true);
  assert.equal(allowed(options, undefined), true);
  for (const origin of [...require("../config/allowedOrigins"), "https://attacker.company.com"]) assert.equal(allowed(options, origin), false);
});
test("local development retains localhost access", () => {
  const options = config({ NODE_ENV: "development" });
  assert.equal(allowed(options, "http://localhost:8081"), true);
  assert.equal(allowed(options, "https://unconfigured.company.com"), false);
});
