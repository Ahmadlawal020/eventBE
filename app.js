require("dotenv").config();
const express = require("express");
const app = express();
app.set("trust proxy", 1);
const path = require("path");
const { logger } = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const corsOptions = require("./config/corsOptions");
const connectDB = require("./config/dbConn");
const helmet = require("helmet");

console.log(process.env.NODE_ENV);

if (process.env.NODE_ENV !== "test") {
  connectDB().catch(() => {
    process.exit(1);
  });
}

// Middleware
app.use(helmet());
app.use(logger);
// The server also hosts its admin page; same-origin requests need no CORS headers.
app.use((req, res, next) => {
  if (req.headers.origin === req.protocol + "://" + req.get("host")) return next();
  return cors(corsOptions)(req, res, next);
});
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(cookieParser());

// Health Check endpoint for load balancers & monitoring
app.get(["/health", "/api/health"], (_req, res) => {
  const mongoose = require("mongoose");
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  const isHealthy = dbState === 1 || process.env.NODE_ENV === "test";

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "UP" : "DEGRADED",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: dbStatusMap[dbState] || "unknown",
    environment: process.env.NODE_ENV || "development",
  });
});

// Serve static files from the "public" directory
app.use("/", express.static(path.join(__dirname, "public")));

app.use("/", require("./routes/root"));

// Operational location assignments can only be changed through the audited admin endpoint.
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/admin/")) return next();
  const forbidden = value => value && typeof value === "object" && Object.entries(value).some(([key, nested]) => key.split(".").includes("managementLocation") || forbidden(nested));
  if (forbidden(req.body)) return res.status(400).json({ success: false, message: "Operating location assignments are managed by administrators" });
  next();
});
// Mount user routes
app.use("/api/auth", require("./routes/client/auth.route"));
app.use("/api/user-info", require("./routes/client/userProfile.route"));
app.use("/api/events", require("./routes/client/event.route"));
app.use("/api/event-centers", require("./routes/client/eventCenter.route"));
app.use(
  "/api/webhooks/payment",
  require("./routes/client/paymentWebhook.route"),
);
app.use(
  "/api/event-center-tickets",
  require("./routes/client/eventCenterTicket.route"),
);
app.use("/api/payments", require("./routes/client/payment.route"));
app.use("/api/listings", require("./routes/client/listings.route"));
app.use(
  "/api/organiser-listings",
  require("./routes/client/organiserListings.route"),
);
app.use("/api/event-tickets", require("./routes/client/eventTicketType.route"));
app.use(
  "/api/user-event-tickets",
  require("./routes/client/userEventTicket.route"),
);
app.use("/api/event-bookings", require("./routes/client/eventBooking.route"));
app.use("/api/tickets", require("./routes/client/ticket.route"));
app.use("/api/wishlist", require("./routes/client/wishlist.route"));
app.use("/api/co-organisers", require("./routes/client/coOrganiser.route"));
app.use("/api/staff", require("./routes/client/staff.route"));
app.use("/api/notifications", require("./routes/client/notification.route"));
app.use("/api/messages", require("./routes/client/message.route"));
app.use("/api/analytics", require("./routes/client/analytics.route"));
app.use(
  "/api/ticket-dashboard",
  require("./routes/client/ticketDashboard.route"),
);
app.use(
  "/api/listing-dashboard",
  require("./routes/client/listingDashboard.route"),
);
app.use(
  "/api/booking-dashboard",
  require("./routes/client/bookingDashboard.route"),
);
app.use(
  "/api/booking-history",
  require("./routes/client/bookingHistory.route"),
);
app.use(
  "/api/finance-dashboard",
  require("./routes/client/financeDashboard.route"),
);
app.use("/api/platform-fees", require("./routes/client/platformFees.route"));
app.use("/api/kyc", require("./routes/client/kyc.route"));
app.use(
  "/api/ticket-transfer",
  require("./routes/client/ticketTransfer.route"),
);
app.use("/api/ticket-export", require("./routes/client/ticketExport.route"));
app.use("/api/referrals", require("./routes/client/referral.route"));

// Mount admin routes
app.use("/api/admin/auth", require("./routes/management/auth.route"));
// All management routes below this boundary use current database permissions.
app.use("/api/admin", require("./middleware/management/verifyAdmin"), require("./middleware/management/geographicBoundary"));
app.use("/api/admin/geography", require("./routes/management/geography.route"));
app.use("/api/admin/dashboard", require("./routes/management/dashboard.route"));
app.use("/api/admin/users", require("./routes/management/users.route"));
app.use("/api/admin/content-moderation", require("./routes/management/moderation.route"));
app.use("/api/admin/listings", require("./routes/management/listings.route"));
app.use("/api/admin/bookings", require("./routes/management/bookings.route"));
app.use("/api/admin/payments", require("./routes/management/payments.route"));
app.use("/api/admin/tickets", require("./routes/management/tickets.route"));
app.use("/api/admin/audit-logs", require("./routes/management/audit.route"));
app.use(
  "/api/admin/platform-fees",
  require("./routes/management/platformFees.route"),
);
app.use("/api/admin/staff", require("./routes/management/staff.route"));
app.use("/api/admin/kyc", require("./routes/management/kyc.route"));
app.use("/api/admin/settings", require("./routes/management/settings.route"));
app.use(
  "/api/admin/event-settings",
  require("./routes/management/eventSettings.route"),
);
app.use(
  "/api/admin/event-center-settings",
  require("./routes/management/eventCenterSettings.route"),
);
app.use("/api/admin/support", require("./routes/management/support.route"));
app.use("/api/admin/transfers", require("./routes/management/transfers.route"));
app.use("/api/admin/refunds", require("./routes/management/refunds.route"));
app.use(
  "/api/admin/co-organisers",
  require("./routes/management/coOrganisers.route"),
);
app.use("/api/admin/search", require("./routes/management/search.route"));
app.use("/api/admin/referrals", require("./routes/management/referrals.route"));

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
