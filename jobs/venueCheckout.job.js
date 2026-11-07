const { reconcileVenueCheckouts, completePastVenueBookings } = require("../services/venueCheckout.service");
const { runWorker } = require("../services/eventOperations.service");
async function run() {
  return runWorker("venue-checkout", async () => ({ ...await reconcileVenueCheckouts(), ...await completePastVenueBookings() }));
}
module.exports = { run };
