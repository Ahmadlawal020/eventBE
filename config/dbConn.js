const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    if (!process.env.DATABASE_URI) {
      throw new Error("DATABASE_URI is not configured");
    }

    await mongoose.connect(process.env.DATABASE_URI, {});
    console.log("MongoDB Connected");
  } catch (err) {
    console.error("Database connection error:", err);
    throw err;
  }
};

module.exports = connectDB;
