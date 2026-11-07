// Configuration-only gate: no network, secret output, database writes, or worker startup.
const fs = require("node:fs"), path = require("node:path"), dotenv = require("dotenv");
const read = file => fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
const root = path.resolve(__dirname, "..");
const values = { server: { ...read(path.join(root, ".env")), ...process.env },
  mobile: { ...read(path.join(root, "../munasaba/.env")), ...(process.env.EXPO_PUBLIC_API_URL ? { EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL } : {}) },
  admin: { ...read(path.join(root, "../eventmdb/.env")), ...(process.env.VITE_API_URL ? { VITE_API_URL: process.env.VITE_API_URL } : {}) } };
const target = process.argv.includes("--staging") ? "staging" : "production";
const errors = require("../services/releaseConfiguration.service").checkReleaseConfiguration(values, target);
console.log(JSON.stringify({ target, ready: errors.length === 0, errors }, null, 2));
if (errors.length) process.exitCode = 1;
