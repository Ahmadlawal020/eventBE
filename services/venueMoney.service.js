const minor = n => Math.round(Number(n || 0) * 100);
function manualMoney(booking, record) {
  const opening = record?.openingPaidMinor ?? (booking.paymentStatus === "COMPLETED" ? minor(booking.totalPrice?.amount) : minor(booking.depositAmount));
  let gross = opening, refunded = 0;
  for (const p of record?.payments || []) {
    if (p.kind === "PAYMENT") gross += p.amountMinor;
    if (p.kind === "REFUND") refunded += p.amountMinor;
  }
  return { grossCollectedMinor: gross, refundedMinor: refunded, confirmedRefundMinor: (record?.refunds || []).filter(r => r.status === "CONFIRMED").reduce((n,r) => n + r.amountMinor, 0), approvedRefundMinor: (record?.refunds || []).filter(r => r.status === "APPROVED").reduce((n,r) => n + r.amountMinor, 0), netCollectedMinor: gross - refunded };
}
function venueMoney(bookings, refunds = [], manualBookings = []) {
  const rows = new Map();
  const row = currency => {
    if (!rows.has(currency)) rows.set(currency, { currency, grossCollections: 0, fees: 0, refundsSent: 0, refundsConfirmed: 0, refundLiability: 0, netReceipts: 0 });
    return rows.get(currency);
  };
  for (const b of bookings) {
    const r = row(b.totalPrice?.currency || "NGN");
    if (!["COMPLETED", "REFUNDED", "FAILED_REFUND"].includes(b.paymentStatus)) continue;
    const gross = minor(b.totalPrice.amount);
    r.grossCollections += gross;
    const providerRefunded = b.paymentStatus === "REFUNDED" || b.refund?.state === "PROCESSED";
    r.fees += providerRefunded ? 0 : minor(b.platformFeeAmount);
    if (providerRefunded) {
      const amount = b.refund?.amountMinor ?? gross;
      r.refundsSent += amount; r.refundsConfirmed += amount;
    } else if (b.refund?.state) r.refundLiability += b.refund.amountMinor || gross;
  }
  for (const f of refunds) {
    const r = row(f.currency || "NGN");
    const sent = f.sentMinor ?? (f.markedPaidAt || f.status === "CONFIRMED_BY_BUYER" ? f.amountMinor : 0);
    r.refundsSent += sent;
    r.refundLiability += Math.max(0, f.amountMinor - sent);
    r.refundsConfirmed += f.confirmedMinor ?? (f.status === "CONFIRMED_BY_BUYER" ? f.amountMinor : 0);
  }
  for (const b of manualBookings) {
    const r = row(b.totalPrice?.currency || "NGN");
    const m = b.manualFinance || manualMoney(b);
    r.grossCollections += m.grossCollectedMinor;
    r.refundsSent += m.refundedMinor; r.refundsConfirmed += m.confirmedRefundMinor || 0;
    if (b.status !== "CANCELLED") r.refundLiability += m.approvedRefundMinor || 0;
    if (b.status === "CANCELLED") r.refundLiability += Math.max(0, m.netCollectedMinor);
  }
  return [...rows.values()].map(r => {
    r.netReceipts = r.grossCollections - r.fees - r.refundsSent;
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? v / 100 : v]));
  });
}
async function loadVenueMoney(venueIds, manualBookings = []) {
  const ids = venueIds.map(String);
  const [bookings, refunds] = await Promise.all([
    require("../models/client/eventCenterBooking.schema").find({ eventCenter: { $in: venueIds } })
      .select("eventCenter bookingUnit totalPrice paymentStatus platformFeeAmount refund createdAt").lean(),
    require("../models/client/eventCenterRefund.schema").find({ eventCenterId: { $in: venueIds } })
      .select("eventCenterId bookingId amountMinor currency markedPaidAt status sentMinor confirmedMinor").lean(),
  ]);
  const manual = manualBookings.filter(b => ids.includes(String(b.eventCenter?._id || b.eventCenter)));
  const currencies = venueMoney(bookings, refunds, manual);
  const perVenue = new Map(venueIds.map(id => [String(id), venueMoney(
    bookings.filter(b => String(b.eventCenter) === String(id)), refunds.filter(r => String(r.eventCenterId) === String(id)),
    manual.filter(b => String(b.eventCenter?._id || b.eventCenter) === String(id)))]));
  const byUnit = ["hour", "day"].map(unit => {
    const subset = bookings.filter(b => b.bookingUnit === unit), bookingIds = new Set(subset.map(b => String(b._id)));
    const values = venueMoney(subset, refunds.filter(r => bookingIds.has(String(r.bookingId))), manual.filter(b => b.bookingUnit === unit));
    return { _id: unit, revenue: values.reduce((sum, r) => sum + r.netReceipts, 0), currencies: values };
  });
  const period = (start, end = new Date()) => {
    const inPeriod = value => value && new Date(value) >= start && new Date(value) <= end;
    const selected = bookings.filter(b => inPeriod(b.createdAt));
    const bookingIds = new Set(selected.map(b => String(b._id)));
    return venueMoney(selected, refunds.filter(r => bookingIds.has(String(r.bookingId))), manual.filter(b => inPeriod(b.createdAt)));
  };
  return { currencies, perVenue, byUnit, period };
}
module.exports = { manualMoney, venueMoney, loadVenueMoney };
