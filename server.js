const app = require("./app");
const mongoose = require("mongoose");
const { logEvents } = require("./middleware/logger");
const PORT = process.env.PORT || 5001;

// Validate critical environment variables at startup
require("./utils/qr");

mongoose.connection.once("open", () => {
  console.log("connected to MongoDB");
  // Initialize cron jobs
  require("./jobs/notificationTrigger.job");
  require("./jobs/reviewBookingExpiry.job");
  require("./jobs/eventCompletion.job");
  app.listen(PORT, () => {
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
