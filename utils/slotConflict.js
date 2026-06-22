/**
 * Check if a proposed hourly slot overlaps with existing booked slots
 *
 * @param {Object} newSlot - { date, startTime, endTime }
 * @param {Array} existingSlots - array of existing unavailableSlots entries
 * @param {String|null} excludeBookingId - bookingId to exclude from conflict check
 * @returns {Boolean} true if conflict found
 */
function hasSlotConflict(newSlot, existingSlots, excludeBookingId) {
  const newDateStr = new Date(newSlot.date).toISOString().split("T")[0];
  const newStart = newSlot.startTime;
  const newEnd = newSlot.endTime;

  return existingSlots.some((existing) => {
    const existingDateStr = new Date(existing.date).toISOString().split("T")[0];
    if (existingDateStr !== newDateStr) return false;
    if (excludeBookingId && String(existing.bookingId) === String(excludeBookingId)) return false;
    if (existing.type !== "BOOKED" && existing.type !== "MANUAL") return false;
    return newStart < existing.endTime && newEnd > existing.startTime;
  });
}

module.exports = { hasSlotConflict };
