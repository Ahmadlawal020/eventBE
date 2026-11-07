// Read-only pre-deployment inventory. Never submits payments or changes accounts.
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Booking = require("../models/client/eventCenterBooking.schema");
const User = require("../models/client/user.schema");
const Payout = require("../models/client/venuePayout.schema");
async function report() {
  if (!process.env.DATABASE_URI) throw new Error("DATABASE_URI is required");
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false, autoCreate: false });
  const result = {
    cancelledPaidWithoutRefundJob: await Booking.countDocuments({ status: "CANCELLED", paymentStatus: { $in: ["COMPLETED", "FAILED_REFUND"] }, "refund.state": { $exists: false } }),
    legacyRefundsWithoutProviderReconciliation: await Booking.countDocuments({ paymentStatus: "REFUNDED", "refund.state": { $exists: false } }),
    pendingBookingsWithoutCheckoutCode: await Booking.countDocuments({ status: "ACTIVE", paymentStatus: "PENDING", $or: [{ checkoutAccessCode: { $exists: false } }, { checkoutAccessCode: null }] }),
    refundsNeedingAttention: await Booking.countDocuments({ "refund.state": "NEEDS_ATTENTION" }),
    payoutsNeedingAttention: await Payout.countDocuments({ status: "NEEDS_ATTENTION" }),
    verifiedLocalAccountsForProvenanceReview: await User.countDocuments({ authProvider: "local", isEmailVerified: true }),
  };
  console.log(JSON.stringify(result, null, 2));
}
report().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.connection.close());
