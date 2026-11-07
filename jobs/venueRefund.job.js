const processVenueRefunds = () => require("../services/eventOperations.service").runWorker("venue-refund", () => require("../services/venueRefund.service").processVenueRefunds());
module.exports = { processVenueRefunds };
