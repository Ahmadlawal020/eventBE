const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const { MongoMemoryServer } = require("mongodb-memory-server");
process.env.NODE_ENV = "test";
process.env.ACCESS_TOKEN_SECRET = "referral-isolated-test-access-secret";
process.env.REFRESH_TOKEN_SECRET = "referral-isolated-test-refresh-secret";
process.env.QR_SIGNING_SECRET = "referral-test-qr-signing-secret-12345678901234567890";
process.env.PAYSTACK_SECRET_KEY = "sk_test_referral_mock";
process.env.PAYMENT_PROVIDER = "paystack";
let database;
const dbName = "referral_test_" + randomUUID().replace(/-/g, "").slice(0, 24);
beforeAll(async () => {
  const uri = process.env.REFERRAL_TEST_DATABASE_URI;
  if (uri) {
    // Explicitly supplied server, always a new random database, never the URI's database.
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 30000 });
  } else {
    database = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
    await mongoose.connect(database.getUri(), { dbName });
  }
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 240000);
afterEach(async () => {
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName) {
    await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  }
  jest.restoreAllMocks();
});
afterAll(async () => {
  try {
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName) {
      try {
        await mongoose.connection.dropDatabase();
      } catch (error) {
        if (error.code !== 13 && !error.message.includes("not allowed")) throw error;
        // Some development accounts can remove documents but cannot drop databases.
        await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
      }
    }
  } finally {
    await mongoose.disconnect();
    if (database) await database.stop();
  }
});
