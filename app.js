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

connectDB().catch(() => {
  process.exit(1);
});

const helmet = require("helmet");

// Middleware
app.use(helmet());
app.use(logger);
app.use(cors(corsOptions));
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(cookieParser());

// Serve static files from the "public" directory
app.use("/", express.static(path.join(__dirname, "public")));

app.use("/", require("./routes/root"));
// Mount user routes
app.use("/api/auth", require("./routes/user/auth.route"));
app.use("/api/user-info", require("./routes/user/userProfile.route"));
app.use("/api/events", require("./routes/user/event.route"));
app.use("/api/event-centers", require("./routes/user/eventCenter.route"));
app.use("/api/webhooks/payment", require("./routes/user/paymentWebhook.route"));
app.use("/api/event-center-tickets", require("./routes/user/eventCenterTicket.route"));
app.use("/api/payments", require("./routes/user/payment.route"));
app.use("/api/listings", require("./routes/user/listings.route"));
app.use("/api/organiser-listings", require("./routes/user/organiserListings.route"));
app.use("/api/event-tickets", require("./routes/user/eventTicketType.route"));
app.use("/api/user-event-tickets", require("./routes/user/userEventTicket.route"));
app.use("/api/event-bookings", require("./routes/user/eventBooking.route"));
app.use("/api/tickets", require("./routes/user/ticket.route"));
app.use("/api/wishlist", require("./routes/user/wishlist.route"));
app.use("/api/co-organisers", require("./routes/user/coOrganiser.route"));
app.use("/api/staff", require("./routes/user/staff.route"));
app.use("/api/notifications", require("./routes/user/notification.route"));
app.use("/api/messages", require("./routes/user/message.route"));
app.use("/api/analytics", require("./routes/user/analytics.route"));
app.use("/api/ticket-dashboard", require("./routes/user/ticketDashboard.route"));
app.use("/api/listing-dashboard", require("./routes/user/listingDashboard.route"));
app.use("/api/booking-dashboard", require("./routes/user/bookingDashboard.route"));
app.use("/api/booking-history", require("./routes/user/bookingHistory.route"));
app.use("/api/finance-dashboard", require("./routes/user/financeDashboard.route"));
app.use("/api/platform-fees", require("./routes/user/platformFees.route"));
app.use("/api/kyc", require("./routes/user/kyc.route"));
app.use("/api/ticket-transfer", require("./routes/user/ticketTransfer.route"));
app.use("/api/ticket-export", require("./routes/user/ticketExport.route"));

// Mount admin routes
app.use("/api/admin/auth", require("./routes/admin/auth.route"));
app.use("/api/admin/dashboard", require("./routes/admin/dashboard.route"));
app.use("/api/admin/users", require("./routes/admin/users.route"));
app.use("/api/admin/listings", require("./routes/admin/listings.route"));
app.use("/api/admin/bookings", require("./routes/admin/bookings.route"));
app.use("/api/admin/payments", require("./routes/admin/payments.route"));
app.use("/api/admin/tickets", require("./routes/admin/tickets.route"));
app.use("/api/admin/audit-logs", require("./routes/admin/audit.route"));
app.use("/api/admin/platform-fees", require("./routes/admin/platformFees.route"));
app.use("/api/admin/staff", require("./routes/admin/staff.route"));
app.use("/api/admin/kyc", require("./routes/admin/kyc.route"));
app.use("/api/admin/settings", require("./routes/admin/settings.route"));



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
