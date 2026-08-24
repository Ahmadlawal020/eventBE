const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
require("dotenv").config();

// Ensure test environment variables
process.env.NODE_ENV = "test";
process.env.ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "test-access-token-secret-1234567890";
process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "test-refresh-token-secret-1234567890";
process.env.QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || "91995aa788854816bdb84b581f02d0c2665c50eba22f3a78d08fa2882f5bc5c3";
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "sk_test_mock_paystack_secret_key";
process.env.PAYMENT_PROVIDER = "paystack";

beforeAll(async () => {
  let testUri = process.env.DATABASE_URI || "mongodb://127.0.0.1:27017/Eventtt_test_automated";
  if (testUri.includes("/Eventtt")) {
    testUri = testUri.replace("/Eventtt", "/Eventtt_test_automated");
  }
  await mongoose.connect(testUri, {});
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((c) => c.deleteMany({})));
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

/**
 * Generates a mock JWT authentication token for tests
 */
const generateAuthToken = (user) => {
  const payload = {
    UserInfo: {
      id: user._id ? String(user._id) : String(user.id),
      email: user.email,
      roles: user.roles || ["user"],
    },
  };
  return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
};

/**
 * Generates a mock Admin JWT authentication token for tests
 */
const generateAdminAuthToken = (admin) => {
  const payload = {
    UserInfo: {
      id: admin._id ? String(admin._id) : String(admin.id),
      email: admin.email,
      roles: admin.roles || ["admin", "superadmin"],
    },
  };
  return jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
};

module.exports = {
  generateAuthToken,
  generateAdminAuthToken,
};
