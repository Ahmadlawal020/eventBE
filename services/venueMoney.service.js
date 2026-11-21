const minor = n => Math.round(Number(n || 0) * 100);
function manualMoney(booking, record) {
  const opening = record?.openingPaidMinor ?? (booking.paymentStatus === "COMPLETED" ? minor(booking.totalPrice?.amount) : minor(booking.depositAmount));
  let gross = opening, refunded = 0;
  for (const p of record?.payments || []) {
    if (p.kind === "PAYMENT") gross += p.amountMinor;
    if (p.kind === "REFUND") refunded += p.amountMinor;
  }
  return { grossCollectedMinor: gross, refundedMinor: refunded, confirmedRefundMinor: (record?.refunds || []).filter(r => r.status === "CONFIRMED").reduce((n,r) => n + r.amountMinor, 0), approvedRefundMinor: (record?.refunds || []).filter(r => r.status === "APPROVED").reduce((n,r) => n + r.amountMinor, 0), netCollectedMinor: gross - refunded, refundDueMinor: Math.max(0, gross - refunded - minor(record?.agreedPrice?.amount ?? booking.totalPrice?.amount)) };
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
    if (b.rescheduleLedger) {
      const ledger = b.rescheduleLedger;
      const extra = (ledger.payments || []).filter(p => p.kind === "PAYMENT").reduce((n,p) => n + p.amountMinor, 0);
      const returned = (ledger.payments || []).filter(p => p.kind === "REFUND").reduce((n,p) => n + p.amountMinor, 0);
      r.grossCollections += extra; r.refundsSent += returned;
      r.fees += (ledger.payments || []).filter(p => p.kind === "PAYMENT").reduce((n, p) => n + (p.platformFeeMinor || 0), 0);
      r.refundsConfirmed += (ledger.refunds || []).filter(f => f.status === "CONFIRMED").reduce((n,f) => n + f.amountMinor, 0);
      if (b.status !== "CANCELLED") r.refundLiability += Math.max(0, gross + extra - returned - minor(ledger.agreedPrice?.amount ?? b.totalPrice.amount));
    }
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
    if (b.status !== "CANCELLED") r.refundLiability += Math.max(m.approvedRefundMinor || 0, m.refundDueMinor || 0);
    if (b.status === "CANCELLED") r.refundLiability += Math.max(0, m.netCollectedMinor);
  }
  return [...rows.values()].map(r => {
    r.netReceipts = r.grossCollections - r.fees - r.refundsSent;
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? v / 100 : v]));
  });
}
function organiserShareMinor(b) {
  if (Number.isFinite(b.organiserPayoutAmount)) return minor(b.organiserPayoutAmount);
  if (Number.isFinite(b.subtotalPrice?.amount)) return minor(b.subtotalPrice.amount);
  return Math.max(0, minor(b.totalPrice?.amount) - minor(b.platformFeeAmount));
}

function venueMoneyBreakdown(bookings = [], refunds = [], manualBookings = [], operations = []) {
  const rows = new Map();
  const row = (currency) => {
    if (!rows.has(currency)) {
      rows.set(currency, {
        currency,
        // Platform collections (organiser's share only, platform fee excluded)
        instantBookingsReceived: 0,
        reviewBookingsReceived: 0,
        reschedulePlatformReceived: 0,
        platformTotalReceived: 0,
        // Direct / offline collections (organiser's share only)
        manualBookingsReceived: 0,
        rescheduleDirectReceived: 0,
        directTotalReceived: 0,
        outstandingDirectBalance: 0,
        // Refunds & returns (organiser's share only)
        cancellationRefundsSent: 0,
        cancellationRefundsConfirmed: 0,
        cancellationRefundsOwed: 0,
        rescheduleRefundsSent: 0,
        rescheduleRefundsConfirmed: 0,
        rescheduleRefundsOwed: 0,
        totalRefundsSent: 0,
        totalRefundsConfirmed: 0,
        totalRefundsOwed: 0,
        // Net organiser earnings (100% platform-fee exempt)
        netOrganiserEarnings: 0,
      });
    }
    return rows.get(currency);
  };

  const opsByBookingId = new Map(operations.map((o) => [String(o.bookingId), o]));

  for (const b of bookings) {
    const r = row(b.totalPrice?.currency || "NGN");
    if (!["COMPLETED", "REFUNDED", "FAILED_REFUND"].includes(b.paymentStatus)) continue;
    const providerRefunded = b.paymentStatus === "REFUNDED" || b.refund?.state === "PROCESSED";
    const providerRefundPending = !providerRefunded && Boolean(b.refund?.state);
    const baseNet = organiserShareMinor(b);

    // If refunded by provider before payout, it was never settled to organiser
    if (!providerRefunded && !providerRefundPending) {
      if (b.bookingMode === "REVIEW") {
        r.reviewBookingsReceived += baseNet;
      } else {
        r.instantBookingsReceived += baseNet;
      }
    }

    const ledger = b.rescheduleLedger || opsByBookingId.get(String(b._id));
    if (ledger?.rescheduleAdjustment) {
      let extraNet = 0;
      let returned = 0;
      for (const p of ledger.payments || []) {
        if (p.kind === "PAYMENT") {
          const netPayment = Math.max(0, (p.amountMinor || 0) - (p.platformFeeMinor || 0));
          extraNet += netPayment;
          if (String(p.method || "").toUpperCase() === "PAYSTACK") {
            r.reschedulePlatformReceived += netPayment;
          } else {
            r.rescheduleDirectReceived += netPayment;
          }
        } else if (p.kind === "REFUND") {
          returned += p.amountMinor || 0;
          r.rescheduleRefundsSent += p.amountMinor || 0;
        }
      }
      r.rescheduleRefundsConfirmed += (ledger.refunds || [])
        .filter((f) => f.status === "CONFIRMED")
        .reduce((n, f) => n + (f.amountMinor || 0), 0);

      if (b.status !== "CANCELLED") {
        const gross = minor(b.totalPrice?.amount);
        const rawExtra = (ledger.payments || [])
          .filter((p) => p.kind === "PAYMENT")
          .reduce((n, p) => n + (p.amountMinor || 0), 0);
        const targetTotal = minor(ledger.agreedPrice?.amount ?? b.totalPrice?.amount);
        const paidTotal = gross + rawExtra - returned;
        const refundDue = Math.max(0, paidTotal - targetTotal);
        const balanceDue = Math.max(0, targetTotal - paidTotal);
        r.rescheduleRefundsOwed += refundDue;
        r.outstandingDirectBalance += balanceDue;
      }
    }
  }

  for (const f of refunds) {
    const r = row(f.currency || "NGN");
    const sent = f.sentMinor ?? (f.markedPaidAt || f.status === "CONFIRMED_BY_BUYER" ? f.amountMinor : 0);
    const confirmed = f.confirmedMinor ?? (f.status === "CONFIRMED_BY_BUYER" ? f.amountMinor : 0);
    const owed = Math.max(0, (f.amountMinor || 0) - sent);
    r.cancellationRefundsSent += sent;
    r.cancellationRefundsConfirmed += confirmed;
    r.cancellationRefundsOwed += owed;
  }

  for (const b of manualBookings) {
    const r = row(b.totalPrice?.currency || "NGN");
    const record = opsByBookingId.get(String(b._id || b.bookingId));
    const m = b.manualFinance || manualMoney(b, record);
    r.manualBookingsReceived += m.grossCollectedMinor;
    r.rescheduleRefundsSent += m.refundedMinor;
    r.rescheduleRefundsConfirmed += m.confirmedRefundMinor || 0;
    if (b.status !== "CANCELLED") {
      const targetTotal = minor(record?.agreedPrice?.amount ?? b.totalPrice?.amount);
      const balanceDue = Math.max(0, targetTotal - m.netCollectedMinor);
      r.outstandingDirectBalance += balanceDue;
      r.rescheduleRefundsOwed += Math.max(m.approvedRefundMinor || 0, m.refundDueMinor || 0);
    } else {
      r.rescheduleRefundsOwed += Math.max(0, m.netCollectedMinor);
    }
  }

  return [...rows.values()].map((r) => {
    r.platformTotalReceived =
      r.instantBookingsReceived + r.reviewBookingsReceived + r.reschedulePlatformReceived;
    r.directTotalReceived = r.manualBookingsReceived + r.rescheduleDirectReceived;
    r.totalRefundsSent = r.cancellationRefundsSent + r.rescheduleRefundsSent;
    r.totalRefundsConfirmed = r.cancellationRefundsConfirmed + r.rescheduleRefundsConfirmed;
    r.totalRefundsOwed = r.cancellationRefundsOwed + r.rescheduleRefundsOwed;
    r.netOrganiserEarnings =
      r.platformTotalReceived + r.directTotalReceived - r.totalRefundsSent;
    return Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? v / 100 : v]),
    );
  });
}

async function loadVenueMoney(venueIds, manualBookings = []) {
  const ids = venueIds.map(String);
  const [bookings, refunds, allOperations] = await Promise.all([
    require("../models/client/eventCenterBooking.schema").find({ eventCenter: { $in: venueIds } })
      .select("eventCenter bookingUnit bookingMode totalPrice subtotalPrice organiserPayoutAmount paymentStatus platformFeeAmount refund createdAt status").lean(),
    require("../models/client/eventCenterRefund.schema").find({ eventCenterId: { $in: venueIds } })
      .select("eventCenterId bookingId amountMinor currency markedPaidAt status sentMinor confirmedMinor").lean(),
    require("../models/client/bookingOperations.schema").find({ eventCenter: { $in: venueIds } }).lean(),
  ]);
  const adjustments = allOperations.filter((op) => op.rescheduleAdjustment);
  for (const booking of bookings) booking.rescheduleLedger = adjustments.find(a => String(a.bookingId) === String(booking._id));
  const manual = manualBookings.filter(b => ids.includes(String(b.eventCenter?._id || b.eventCenter)));
  const currencies = venueMoney(bookings, refunds, manual);
  const breakdown = venueMoneyBreakdown(bookings, refunds, manual, allOperations);
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
  return { currencies, breakdown, allOperations, perVenue, byUnit, period };
}
module.exports = { manualMoney, venueMoney, venueMoneyBreakdown, loadVenueMoney };
