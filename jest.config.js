module.exports = {
  testEnvironment: "node",
  testTimeout: 60000,
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  testMatch: ["**/tests/**/*.test.js"],
  // Referral integration tests use their own isolated database setup.
  testPathIgnorePatterns: ["/referral.test.js$"],
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
