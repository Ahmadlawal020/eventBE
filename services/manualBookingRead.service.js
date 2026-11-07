const idOf = value => String(value?._id || value);

// Availability is authoritative for active bookings; history retains removed bookings.
function buildManualBookings(venues, history = [], checkIns = [], now = new Date()) {
  const output = [];
  for (const venue of venues) {
    const groups = new Map();
    const ensure = bookingId => {
      if (!groups.has(bookingId)) groups.set(bookingId, { entries: [], history: [] });
      return groups.get(bookingId);
    };
    for (const entry of [...(venue.availability?.unavailableDates || []), ...(venue.availability?.unavailableSlots || [])]) {
      if (entry?.type === "MANUAL" && entry.bookingId) ensure(String(entry.bookingId)).entries.push(entry);
    }
    for (const entry of history) {
      if (idOf(entry.eventCenter) === idOf(venue) && entry.bookingType === "MANUAL") ensure(entry.bookingId).history.push(entry);
    }
    for (const [bookingId, group] of groups) {
      group.history.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const created = group.history.find(entry => entry.action === "CREATED");
      const latest = group.history[group.history.length - 1];
      const scheduled = [...group.history].reverse().find(entry => ["CREATED", "RESCHEDULED"].includes(entry.action));
      const entry = group.entries[0];
      const unit = entry?.bookingUnit || created?.bookingUnit || scheduled?.bookingUnit || (entry?.startTime || venue.basePrice?.unit === "hour" ? "hour" : "day");
      const dates = (entry ? group.entries : (scheduled?.dates || [])).map(item => {
        if (item.startTime && item.endTime) return { date: item.date, startTime: item.startTime, endTime: item.endTime };
        if (unit === "hour" && entry) {
          const session = require("./bookingAttendance.service").bookingSessions({ bookingUnit: "hour", selectedDates: [item] })[0];
          return session ? { date: session.date, startTime: session.startTime, endTime: session.endTime } : { date: item.date };
        }
        return { date: item.date };
      }).filter(item => !Number.isNaN(new Date(item.date).getTime()));
      const uniqueDates = [...new Map(dates.map(item => [`${new Date(item.date).toISOString().slice(0, 10)}:${item.startTime || ""}:${item.endTime || ""}`, item])).values()]
        .sort((a, b) => new Date(a.date) - new Date(b.date) || (a.startTime || "").localeCompare(b.startTime || ""));
      const sessions = require("./bookingAttendance.service").bookingSessions({ selectedDates: uniqueDates, bookingUnit: unit });
      const last = sessions[sessions.length - 1];
      const status = !entry ? "CANCELLED" : last && new Date(last.endsAt) <= now ? "COMPLETED" : "ACTIVE";
      const record = checkIns.find(item => idOf(item.eventCenter) === idOf(venue) && item.bookingId === bookingId);
      const checkInHistory = group.history.find(item => item.action === "CHECKED_IN");
      const checkIn = record || checkInHistory ? {
        isCheckedIn: true, checkedInAt: record?.checkedInAt || checkInHistory.createdAt,
        checkedInBy: record?.checkedInBy || checkInHistory.performedBy, method: "MANUAL",
      } : { isCheckedIn: false };
      const amount = entry?.totalPrice ?? created?.totalPrice?.amount ?? 0;
      const paymentStatus = ({ paid: "COMPLETED", partially_paid: "PARTIALLY_PAID", pending: "PENDING" })[entry?.paymentStatus] || "PENDING";
      const duration = unit === "hour" ? uniqueDates.reduce((total, item) => {
        const minutes = (time, end = false) => { if (end && time === "00:00") return 1440; const [h, m] = time.split(":").map(Number); return h * 60 + m; };
        return total + (item.startTime && item.endTime ? (minutes(item.endTime, true) - minutes(item.startTime)) / 60 : 1);
      }, 0) : uniqueDates.length;
      output.push({
        _id: bookingId, bookingId, bookingType: "MANUAL", status, bookingUnit: unit, duration,
        guestName: entry?.clientName || created?.guestName || "Guest",
        guestEmail: entry?.clientEmail || created?.guestDetails?.email || "", guestPhone: entry?.clientPhone || created?.guestDetails?.phoneNumber || "",
        guestDetails: { fullName: entry?.clientName || created?.guestName || "Guest", email: entry?.clientEmail || created?.guestDetails?.email || "", phoneNumber: entry?.clientPhone || created?.guestDetails?.phoneNumber || "" },
        dates: uniqueDates, selectedDates: uniqueDates, paymentStatus,
        totalPrice: { amount, currency: entry?.currency || created?.totalPrice?.currency || venue.basePrice?.currency || "NGN" },
        depositAmount: entry?.depositAmount || 0, checkIn,
        eventCenter: { _id: venue._id, venueName: venue.venueName, images: venue.images, location: venue.location },
        createdAt: created?.createdAt || null,
        updatedAt: latest?.createdAt || venue.updatedAt || venue.createdAt || null,
      });
    }
  }
  return output;
}

async function getManualBookings(venues) {
  if (!venues.length) return [];
  const ids = venues.map(venue => venue._id);
  const [history, checkIns, operations] = await Promise.all([
    require("../models/client/bookingHistory.schema").find({ eventCenter: { $in: ids }, bookingType: "MANUAL" }).lean(),
    require("../models/client/manualBookingCheckIn.schema").find({ eventCenter: { $in: ids } }).lean(),
    require("../models/client/bookingOperations.schema").find({ eventCenter: { $in: ids } }).lean(),
  ]);
  const snapshots = operations.filter(o => o.bookingSnapshot && !history.some(h => String(h.eventCenter) === String(o.eventCenter) && h.bookingId === o.bookingId && h.action === "CREATED"))
    .map(o => ({ ...o.bookingSnapshot, eventCenter: o.eventCenter, bookingId: o.bookingId, bookingType: "MANUAL", action: "CREATED", createdAt: o.bookingSnapshot.createdAt || o.createdAt }));
  return buildManualBookings(venues, [...history, ...snapshots], checkIns).map(booking => {
    const record = operations.find(item => String(item.eventCenter) === String(booking.eventCenter._id) && item.bookingId === booking.bookingId);
    if (!record) return { ...booking, manualFinance: require("./venueMoney.service").manualMoney(booking) };
    if (record.bookingSnapshot) {
      const snapshot = record.bookingSnapshot;
      booking.bookingUnit = snapshot.bookingUnit || booking.bookingUnit;
      if (booking.status === "CANCELLED") {
        booking.totalPrice = snapshot.totalPrice || booking.totalPrice;
        booking.guestName = snapshot.guestName || booking.guestName;
        booking.guestDetails = snapshot.guestDetails || booking.guestDetails;
        booking.selectedDates = snapshot.dates || booking.selectedDates; booking.dates = booking.selectedDates;
      }
    }
    const summary = require("./bookingOperations.service").paymentSummary(booking, record);
    return { ...booking, buyer: record.customerId, manualFinance: require("./venueMoney.service").manualMoney(booking, record), depositAmount: summary.paidMinor / 100,
      paymentStatus: summary.paidMinor >= summary.totalMinor ? "COMPLETED" : summary.paidMinor > 0 ? "PARTIALLY_PAID" : "PENDING" };
  });
}
const manualCollectedAmount = booking => booking.status === "CANCELLED" ? 0 : booking.paymentStatus === "COMPLETED"
  ? booking.totalPrice.amount : Math.min(booking.totalPrice.amount, booking.depositAmount || 0);
module.exports = { buildManualBookings, getManualBookings, manualCollectedAmount };
