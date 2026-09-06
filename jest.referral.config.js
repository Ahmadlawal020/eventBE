module.exports = {
  testEnvironment: "node",
  testTimeout: 120000,
  setupFilesAfterEnv: ["<rootDir>/tests/referral.setup.js"],
  testMatch: ["**/tests/referral.test.js"],
  clearMocks: true,
  verbose: true,
};
