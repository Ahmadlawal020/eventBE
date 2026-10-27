const app = require("./app");
const mongoose = require("mongoose");
const { logEvents } = require("./middleware/logger");
const PORT = process.env.PORT || 5001;

// Validate critical environment variables at startup
require("./utils/qr");

let server;

mongoose.connection.once("open", () => {
  console.log("connected to MongoDB");
  // Initialize cron jobs
  require("./jobs/notificationTrigger.job");
  require("./jobs/reviewBookingExpiry.job");
  require("./jobs/eventCompletion.job");
  require("./jobs/eventMediaCleanup.job");
  require("./jobs/eventAlerts.job");
  require("./jobs/paymentReservationExpiry.job");
  require("./jobs/venuePayout.job");
  require("./jobs/venueHoldExpiry.job");
  require("./jobs/venueReminder.job");
  require("./jobs/referralReconciliation.job");
  require("./jobs/refundOperations.job");
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

mongoose.connection.on("error", (err) => {
  console.log(err);
  logEvents(
    `${err.no}: ${err.code}\t${err.syscall}\t${err.hostname}`,
    "mongoErrLog.log",
  );
});

// Graceful Shutdown Handling
const gracefulShutdown = (signal) => {
  console.log(
    `${signal} signal received: closing HTTP server and MongoDB connection...`,
  );
  if (server) {
    server.close(() => {
      console.log("HTTP server closed.");
      mongoose.connection
        .close(false)
        .then(() => {
          console.log("MongoDB connection closed.");
          process.exit(0);
        })
        .catch((err) => {
          console.error("Error closing MongoDB connection:", err);
          process.exit(1);
        });
    });
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  logEvents(`Unhandled Rejection: ${reason}`, "errLog.log");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception thrown:", error);
  logEvents(
    `Uncaught Exception: ${error.stack || error.message}`,
    "errLog.log",
  );
});
