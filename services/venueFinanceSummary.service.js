function venueFinanceSummary(payouts, manualBookings) {
  const currencies = new Map();
  const get = currency => { if (!currencies.has(currency)) currencies.set(currency, { currency, confirmedPayouts: 0, pendingPayouts: 0, payoutAttention: 0, directCollections: 0, outstandingDirect: 0 }); return currencies.get(currency); };
  for (const payout of payouts) {
    const row = get(payout.currency || "NGN"), amount = payout.amountMinor / 100;
    if (payout.status === "SUCCESS") row.confirmedPayouts += amount;
    else if (["READY", "SUBMITTING", "PENDING"].includes(payout.status)) row.pendingPayouts += amount;
    else row.payoutAttention += amount;
  }
  for (const booking of manualBookings) {
    const row = get(booking.totalPrice.currency || "NGN");
    const paid = booking.paymentStatus === "COMPLETED" ? booking.totalPrice.amount : booking.depositAmount || 0;
    row.directCollections += paid; if (booking.status !== "CANCELLED") row.outstandingDirect += Math.max(0, booking.totalPrice.amount - paid);
  }
  return [...currencies.values()];
}
module.exports = { venueFinanceSummary };
