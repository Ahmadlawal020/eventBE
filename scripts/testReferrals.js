require("dotenv").config();
if (process.env.REFERRAL_TEST_DNS) require("dns").setServers(process.env.REFERRAL_TEST_DNS.split(","));
if (!process.env.REFERRAL_TEST_DATABASE_URI) process.env.REFERRAL_TEST_DATABASE_URI = process.env.DATABASE_URI;
if (!process.env.REFERRAL_TEST_DATABASE_URI) throw new Error("Configure DATABASE_URI or REFERRAL_TEST_DATABASE_URI");
process.argv = [process.execPath, "jest", "--config", "jest.referral.config.js", "--runInBand", ...process.argv.slice(2)];
require("jest/bin/jest");
