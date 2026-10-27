// Read-only checks. Never sends email, uploads images, creates indexes or repairs data.
require("dotenv").config();
const mongoose = require("mongoose");
async function main() {
  const result = {
    configuration: Object.fromEntries(
      [
        "DATABASE_URI",
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
        "RESEND_API_KEY",
        "EMAIL_FROM",
        "EVENT_ALERT_WEBHOOK_URL",
      ].map((key) => [key, Boolean(process.env[key])]),
    ),
    databaseChecked: false,
  };
  if (process.argv.includes("--database")) {
    if (!process.env.DATABASE_URI) throw Error("DATABASE_URI is missing");
    await mongoose.connect(process.env.DATABASE_URI, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 10000,
    });
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      result.databaseChecked = true;
      result.transactionsSupported = Boolean(
        hello.setName || hello.msg === "isdbgrid",
      );
      const Refund = require("../models/client/eventRefund.schema");
      const indexes = await Refund.collection.indexes();
      result.ticketRefundUniqueIndex = indexes.some(
        (index) =>
          index.unique &&
          index.key.ticketId === 1 &&
          Object.keys(index.key).length === 1,
      );
      result.legacyBookingUniqueIndex = indexes.some(
        (index) =>
          index.unique &&
          index.key.eventId === 1 &&
          index.key.bookingId === 1 &&
          !index.key.ticketId,
      );
      result.eventIndexes = {};
      for (const [name, modelPath, keys] of [
        ["checkoutAttempt", "../models/client/eventBooking.schema", { buyer: 1, checkoutKey: 1 }],
        ["eventMedia", "../models/client/eventMedia.schema", { publicId: 1 }],
        ["ticketVoidReview", "../models/client/ticketVoidReview.schema", { ticketId: 1 }],
        ["workerLease", "../models/client/refundWorkerHealth.schema", { name: 1 }],
      ]) {
        const declared = await require(modelPath).collection.indexes();
        result.eventIndexes[name] = declared.some(index => index.unique && JSON.stringify(index.key) === JSON.stringify(keys) && (name !== "checkoutAttempt" || index.partialFilterExpression?.checkoutKey?.$type === "string"));
      }
      result.eventOperations = await require("../services/eventOperations.service").getEventOperations();
      result.legacyRefunds = await Refund.countDocuments({ ticketId: null });
      result.operations =
        await require("../services/refundOperations.service").getRefundOperations();
    } finally {
      await mongoose.disconnect();
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (
    Object.values(result.configuration).some((value) => !value) ||
    result.transactionsSupported === false ||
    result.ticketRefundUniqueIndex === false ||
    result.legacyBookingUniqueIndex ||
    result.legacyRefunds > 0 ||
    result.operations?.alerts.length ||
    result.eventOperations?.alerts.length ||
    (result.eventIndexes && Object.values(result.eventIndexes).some(value => !value))
  )
    process.exitCode = 1;
}
main().catch((error) => {
  console.error("Refund readiness check failed:", error.name);
  process.exitCode = 1;
});
