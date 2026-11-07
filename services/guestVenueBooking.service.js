const { publicVenue } = require("./publicVenue.service");
function guestVenueBooking(record) {
  const booking = record?.toObject ? record.toObject() : { ...record };
  if (booking.eventCenter && typeof booking.eventCenter === "object" && booking.eventCenter.venueName !== undefined)
    booking.eventCenter = publicVenue(booking.eventCenter);
  return booking;
}
module.exports = { guestVenueBooking };
