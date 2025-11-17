const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DATABASE_URI, {});
    console.log("MongoDB Connected");
  } catch (err) {
    console.error("Database connection error:", err);
  }
};

module.exports = connectDB;
