require("dotenv").config();
const express = require("express");
const app = express();
const path = require("path");
const { logger } = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const corsOptions = require("./config/corsOptions");
const connectDB = require("./config/dbConn");

console.log(process.env.NODE_ENV);

connectDB();

// Middleware
app.use(logger);
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Serve static files from the "public" directory
app.use("/", express.static(path.join(__dirname, "public")));

app.use("/", require("./routes/root"));
// Mount user routes
app.use("/api/auth", require("./routes/user/auth.route"));
app.use("/api/user-info", require("./routes/user/info.route"));
app.use("/api/events", require("./routes/user/event.route"));
// 404 Handler - Catch-all for unmatched routes
app.all("*", (req, res) => {
  res.status(404); // Set status to 404
  if (req.accepts("html")) {
    res.sendFile(path.join(__dirname, "views", "404.html"));
  } else if (req.accepts("json")) {
    res.json({ message: "404 Not Found" });
  } else {
    res.type("txt").send("404 Not Found");
  }
});
// Error handling middleware
app.use(errorHandler);

module.exports = app;
