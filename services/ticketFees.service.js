const PlatformFees = require("../models/management/platformFees.schema");

const TICKET_FEE_MODES = Object.freeze([
  "ORGANISER_CHOICE",
  "PASS_TO_BUYER",
  "ABSORB_BY_ORGANISER",
]);

const DEFAULT_TICKET_FEES = Object.freeze({
  eventCommission: 15,
  ticketFeesEnabled: true,
  ticketFeeMode: "ORGANISER_CHOICE",
  ticketFixedFeeCents: 0,
  ticketFeeCapCents: null,
});

const asMinorUnit = (value, fallback = 0) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount)
    : fallback;
};

const normaliseTicketFeeSettings = (source = {}) => ({
  eventCommission:
    Number.isFinite(Number(source.eventCommission))
      ? Number(source.eventCommission)
      : DEFAULT_TICKET_FEES.eventCommission,
  ticketFeesEnabled:
    source.ticketFeesEnabled !== undefined
      ? source.ticketFeesEnabled === true
      : DEFAULT_TICKET_FEES.ticketFeesEnabled,
  ticketFeeMode: TICKET_FEE_MODES.includes(source.ticketFeeMode)
    ? source.ticketFeeMode
    : DEFAULT_TICKET_FEES.ticketFeeMode,
  ticketFixedFeeCents: asMinorUnit(
    source.ticketFixedFeeCents,
    DEFAULT_TICKET_FEES.ticketFixedFeeCents,
  ),
  ticketFeeCapCents:
    source.ticketFeeCapCents === null ||
    source.ticketFeeCapCents === undefined
      ? null
      : asMinorUnit(source.ticketFeeCapCents),
});

const getPlatformFees = () =>
  PlatformFees.findOneAndUpdate(
    { key: "platform_fees" },
    { $setOnInsert: { key: "platform_fees" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

const publicTicketFeeSettings = (source) => {
  const settings = normaliseTicketFeeSettings(source);
  return {
    enabled: settings.ticketFeesEnabled,
    percentage: settings.eventCommission,
    mode: settings.ticketFeeMode,
    fixedFeeCents: settings.ticketFixedFeeCents,
    capCents: settings.ticketFeeCapCents,
    currencyCode: "NGN",
  };
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const calculateEventCenterPricing = ({ subtotalAmount, fees, feeMode }) => {
  const safeSubtotal = roundMoney(Math.max(0, Number(subtotalAmount) || 0));
  const percentage = Number.isFinite(Number(fees?.eventCenterCommission))
    ? Number(fees.eventCenterCommission)
    : 15;
  const platformFeeAmount = roundMoney((safeSubtotal * percentage) / 100);
  const mode = feeMode === "deduct" ? "ABSORB_BY_ORGANISER" : "PASS_TO_BUYER";
  const buyerFeeAmount = mode === "PASS_TO_BUYER" ? platformFeeAmount : 0;
  const organiserFeeAmount = mode === "ABSORB_BY_ORGANISER"
    ? Math.min(platformFeeAmount, safeSubtotal)
    : 0;

  return {
    currency: "NGN",
    subtotalAmount: safeSubtotal,
    percentage,
    mode,
    platformFeeAmount,
    buyerFeeAmount,
    organiserFeeAmount,
    totalAmount: roundMoney(safeSubtotal + buyerFeeAmount),
    organiserPayoutAmount: roundMoney(safeSubtotal - organiserFeeAmount),
  };
};

const effectiveLineMode = (configuredMode, commissionType) => {
  if (configuredMode === "PASS_TO_BUYER") return "PASS_TO_BUYER";
  if (configuredMode === "ABSORB_BY_ORGANISER") {
    return "ABSORB_BY_ORGANISER";
  }
  return commissionType === "ADD_ON"
    ? "PASS_TO_BUYER"
    : "ABSORB_BY_ORGANISER";
};

// Scale fee components to a cap while keeping the buyer/organiser allocation
// proportional and ensuring the integer minor-unit components add up exactly.
const scaleComponents = (components, targetTotal) => {
  const originalTotal = components.reduce((sum, value) => sum + value, 0);
  if (originalTotal <= targetTotal) return [...components];
  if (targetTotal <= 0 || originalTotal <= 0) {
    return components.map(() => 0);
  }

  const allocations = components.map((value, index) => {
    const exact = (value * targetTotal) / originalTotal;
    const floor = Math.floor(exact);
    return { index, amount: floor, remainder: exact - floor };
  });
  let remainder =
    targetTotal - allocations.reduce((sum, item) => sum + item.amount, 0);
  allocations
    .slice()
    .sort((left, right) =>
      right.remainder === left.remainder
        ? left.index - right.index
        : right.remainder - left.remainder,
    )
    .forEach((item) => {
      if (remainder > 0) {
        allocations[item.index].amount += 1;
        remainder -= 1;
      }
    });

  return allocations.map((item) => item.amount);
};

/**
 * Calculate an immutable event-ticket order breakdown.
 * Every amount returned is an integer in the currency's smallest unit.
 */
const calculateTicketPricing = ({
  items = [],
  fees,
  currency = { code: "NGN", symbol: "₦" },
}) => {
  const settings = normaliseTicketFeeSettings(fees);
  const lines = items.map((item) => {
    const subtotalAmount = asMinorUnit(
      item.subtotalAmount ?? item.totalPrice,
    );
    const mode = effectiveLineMode(
      settings.ticketFeeMode,
      item.commissionType,
    );
    const rawFeeAmount = settings.ticketFeesEnabled
      ? Math.round((subtotalAmount * settings.eventCommission) / 100)
      : 0;
    return {
      ticketId: String(item.ticketId || item._id || ""),
      name: item.name || "Event ticket",
      quantity: asMinorUnit(item.quantity, 1),
      pricePerUnit: asMinorUnit(item.pricePerUnit),
      subtotalAmount,
      feeMode: mode,
      rawFeeAmount,
    };
  });

  const subtotalAmount = lines.reduce(
    (sum, line) => sum + line.subtotalAmount,
    0,
  );
  const rawPercentageFeeAmount = lines.reduce(
    (sum, line) => sum + line.rawFeeAmount,
    0,
  );
  const rawFixedFeeAmount =
    settings.ticketFeesEnabled && subtotalAmount > 0
      ? settings.ticketFixedFeeCents
      : 0;
  const uncappedFeeAmount = rawPercentageFeeAmount + rawFixedFeeAmount;

  let maximumFeeAmount = uncappedFeeAmount;
  if (settings.ticketFeeCapCents !== null) {
    maximumFeeAmount = Math.min(
      maximumFeeAmount,
      settings.ticketFeeCapCents,
    );
  }
  if (settings.ticketFeeMode === "ABSORB_BY_ORGANISER") {
    maximumFeeAmount = Math.min(maximumFeeAmount, subtotalAmount);
  }

  const scaled = scaleComponents(
    [...lines.map((line) => line.rawFeeAmount), rawFixedFeeAmount],
    maximumFeeAmount,
  );
  const effectiveFixedFeeAmount = scaled.at(-1) || 0;

  const pricedItems = lines.map((line, index) => {
    const feeAmount = scaled[index] || 0;
    const buyerFeeAmount =
      line.feeMode === "PASS_TO_BUYER" ? feeAmount : 0;
    const organiserFeeAmount = feeAmount - buyerFeeAmount;
    return {
      ticketId: line.ticketId,
      name: line.name,
      quantity: line.quantity,
      pricePerUnit: line.pricePerUnit,
      subtotalAmount: line.subtotalAmount,
      feeMode: line.feeMode,
      feeAmount,
      buyerFeeAmount,
      organiserFeeAmount,
      totalAmount: line.subtotalAmount + buyerFeeAmount,
    };
  });

  // With organiser choice, a platform-level fixed order charge is shown to the
  // buyer. A forced mode applies it to the same party as percentage charges.
  const fixedFeeMode =
    settings.ticketFeeMode === "ABSORB_BY_ORGANISER"
      ? "ABSORB_BY_ORGANISER"
      : "PASS_TO_BUYER";
  const fixedBuyerFeeAmount =
    fixedFeeMode === "PASS_TO_BUYER" ? effectiveFixedFeeAmount : 0;
  const fixedOrganiserFeeAmount =
    effectiveFixedFeeAmount - fixedBuyerFeeAmount;
  const percentageFeeAmount = pricedItems.reduce(
    (sum, item) => sum + item.feeAmount,
    0,
  );
  const platformFeeAmount = percentageFeeAmount + effectiveFixedFeeAmount;
  const buyerFeeAmount =
    pricedItems.reduce((sum, item) => sum + item.buyerFeeAmount, 0) +
    fixedBuyerFeeAmount;
  const organiserFeeAmount =
    pricedItems.reduce((sum, item) => sum + item.organiserFeeAmount, 0) +
    fixedOrganiserFeeAmount;

  return {
    currency: {
      code: currency?.code || "NGN",
      symbol: currency?.symbol || "₦",
    },
    enabled: settings.ticketFeesEnabled,
    mode: settings.ticketFeeMode,
    percentage: settings.eventCommission,
    capAmount: settings.ticketFeeCapCents,
    subtotalAmount,
    percentageFeeAmount,
    fixedFeeAmount: effectiveFixedFeeAmount,
    fixedFeeMode,
    platformFeeAmount,
    buyerFeeAmount,
    organiserFeeAmount,
    totalAmount: subtotalAmount + buyerFeeAmount,
    organiserPayoutAmount: Math.max(
      0,
      subtotalAmount - organiserFeeAmount,
    ),
    uncappedFeeAmount,
    items: pricedItems,
  };
};

module.exports = {
  DEFAULT_TICKET_FEES,
  TICKET_FEE_MODES,
  calculateEventCenterPricing,
  calculateTicketPricing,
  getPlatformFees,
  normaliseTicketFeeSettings,
  publicTicketFeeSettings,
};
