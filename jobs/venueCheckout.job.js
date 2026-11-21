const { reconcileVenueCheckouts, completePastVenueBookings } = require("../services/venueCheckout.service");
const { runWorker } = require("../services/eventOperations.service");
async function run() {
  return runWorker("venue-checkout", async () => {
    const checkout = await reconcileVenueCheckouts();
    const reschedule = await require("../services/clientVenueReschedule.service").reconcile();
    return { ...checkout, ...await completePastVenueBookings(), rescheduleProcessed: reschedule.processed, deferred: (checkout.deferred || 0) + reschedule.deferred, failed: (checkout.failed || 0) + reschedule.failed };
  });
}
module.exports = { run };
