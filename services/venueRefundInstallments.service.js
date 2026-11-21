const mongoose = require("mongoose");
const Refund = require("../models/client/eventCenterRefund.schema");
const { queueNotices } = require("./eventCenterRefundNotifications.service");
const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
async function markPaid(id, actor, payload) {
  return mongoose.connection.transaction(async session => {
    const r = await Refund.findOne({ _id: id, organiser: actor, ticketId: { $type: "objectId" } }).select("+receipt.publicId +bankDetails.accountNumber +bankDetails.bankCode").session(session);
    if (!r) fail("Refund not found.");
    if (r.installments?.some(p => p.id === payload.settlementId)) return r;
    if (!["DUE_FROM_ORGANISER", "OVERDUE"].includes(r.status) || r.markedPaidAt || !r.settlement?.id || r.settlement.id !== payload.settlementId || r.receipt?.settlementId !== payload.settlementId || !r.receipt?.publicId || !r.receipt.uploadedAt || r.settlement.bankDetailsVersion !== r.bankDetailsVersion) fail("Lock the refund account and upload a receipt before recording this payment.");
    require("./eventCenterRefundBankDetails.service").normalizeRefundBankDetails(r.bankDetails.toObject());
    const remaining = r.amountMinor - (r.sentMinor || 0), amount = payload.amountMinor ?? remaining;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) fail("Payment must be positive and no greater than the remaining refund.");
    if (typeof payload.organiserReference !== "string" || payload.organiserReference.length > 200) fail("Enter a reference of up to 200 characters.");
    r.installments.push({ id: payload.settlementId, amountMinor: amount, reference: payload.organiserReference.trim(), sentAt: new Date(), receipt: r.receipt.toObject() });
    r.sentMinor = (r.sentMinor || 0) + amount;
    r.status = "MARKED_PAID"; r.paidSettlementId = payload.settlementId; r.organiserReference = payload.organiserReference.trim();
    r.markedPaidAt = new Date(); r.confirmationDueAt = new Date(Date.now() + 7 * 86400000);
    await r.save({ session });
    await queueNotices([{ key: `refund-paid:${r._id}:${payload.settlementId}`, recipient: r.buyer, sender: actor, type: "SYSTEM",
      title: "Refund payment sent", message: `The organiser recorded ${r.currency} ${(amount / 100).toFixed(2)}. Confirm this payment only after it reaches your account.`,
      data: { refundId: String(r._id), screen: "VenueRefundDetails" } }], session);
    return r;
  });
}
async function confirm(id, actor, settlementId) {
  return mongoose.connection.transaction(async session => {
    const r = await Refund.findOne({ _id: id, buyer: actor, ticketId: { $type: "objectId" } }).session(session);
    if (!r) fail("Refund not found.");
    // Older clients can confirm a single full payment; partial payments require their exact ID.
    if (!settlementId && r.installments?.length === 1 && r.installments[0].amountMinor === r.amountMinor) settlementId = r.installments[0].id;
    const part = r.installments?.find(p => p.id === settlementId);
    if (part?.confirmedAt) return r;
    if (!["MARKED_PAID", "DISPUTED", "OVERDUE"].includes(r.status) || !r.markedPaidAt) fail("No refund payment is awaiting confirmation.");
    if (r.installments?.length && (!part || part.id !== r.paidSettlementId)) fail("Refresh and confirm the current payment.");
    const amount = part ? part.amountMinor : r.amountMinor;
    if (part) part.confirmedAt = new Date();
    r.confirmedMinor = (r.confirmedMinor || 0) + amount;
    const complete = r.confirmedMinor === r.amountMinor;
    r.status = complete ? "CONFIRMED_BY_BUYER" : "DUE_FROM_ORGANISER";
    r.confirmedAt = complete ? new Date() : undefined;
    if (!complete) { r.markedPaidAt = undefined; r.confirmationDueAt = undefined; r.settlement = undefined; r.receipt = undefined; r.pendingReceiptPublicId = undefined; }
    r.supportRequest = { ...r.supportRequest?.toObject(), status: "RESOLVED" };
    r.disputeReason = undefined;
    r.set("managementCase.status", "RESOLVED"); r.set("managementCase.resolvedAt", new Date());
    r.set("managementCase.resolution", "Buyer confirmed receipt of this payment.");
    await r.save({ session });
    const venue = r.eventCenterId
      ? await require("../models/client/eventCenter.schema").findById(r.eventCenterId).select("coOrganisers").session(session).lean()
      : null;
    const hostRecipients = [...new Set([r.organiser, ...(venue?.coOrganisers || [])].filter(Boolean).map(String))];
    await queueNotices(hostRecipients.map((recipient) => ({
      key: recipient === String(r.organiser)
        ? `refund-confirmed:${r._id}:${settlementId || "legacy"}`
        : `refund-confirmed:${r._id}:${settlementId || "legacy"}:${recipient}`,
      recipient, sender: actor, type: "SYSTEM",
      title: complete ? "Refund received in full" : "Refund installment received", message: `The buyer confirmed ${r.currency} ${(amount / 100).toFixed(2)}.`,
      data: { bookingId: String(r.bookingId), refundId: String(r._id), screen: "OrganiserVenueRefund" },
    })), session);
    return r;
  });
}
module.exports = { markPaid, confirm };
