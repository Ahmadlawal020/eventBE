const { dayOf } = require("./bookingAttendance.service");
const weekendDay = value => [0, 6].includes(new Date(dayOf(value) + "T12:00:00Z").getUTCDay());
function minimumDuration(venue, day) {
  const price = weekendDay(day) && venue.weekendPrice?.amount > 0 ? venue.weekendPrice : venue.basePrice;
  return Math.max(1,
    venue.basePrice?.unit === "hour" ? Number(price?.minDuration || venue.basePrice?.minDuration || 1) : 1);
}
module.exports = { weekendDay, minimumDuration };
