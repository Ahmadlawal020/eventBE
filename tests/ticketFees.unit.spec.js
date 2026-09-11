const {
  calculateEventCenterPricing,
  calculateTicketPricing,
} = require("../services/ticketFees.service");
const {
  calculateAffiliateReward,
} = require("../services/referral.service");

describe("platform fee calculations", () => {
  const fees = {
    eventCommission: 15,
    eventCenterCommission: 12,
    ticketFeesEnabled: true,
    ticketFeeMode: "ORGANISER_CHOICE",
    ticketFixedFeeCents: 100,
    ticketFeeCapCents: null,
  };

  it("separates attendee add-on fees from organiser deductions", () => {
    const pricing = calculateTicketPricing({
      fees,
      items: [
        {
          ticketId: "add-on",
          quantity: 2,
          pricePerUnit: 10000,
          subtotalAmount: 20000,
          commissionType: "ADD_ON",
        },
        {
          ticketId: "absorbed",
          quantity: 1,
          pricePerUnit: 10000,
          subtotalAmount: 10000,
          commissionType: "DEDUCT_FROM_PRICE",
        },
      ],
    });

    expect(pricing.subtotalAmount).toBe(30000);
    expect(pricing.platformFeeAmount).toBe(4600);
    expect(pricing.buyerFeeAmount).toBe(3100);
    expect(pricing.organiserFeeAmount).toBe(1500);
    expect(pricing.totalAmount).toBe(33100);
    expect(pricing.organiserPayoutAmount).toBe(28500);
  });

  it("supports a capped, forced organiser-paid ticket fee", () => {
    const pricing = calculateTicketPricing({
      fees: {
        ...fees,
        ticketFeeMode: "ABSORB_BY_ORGANISER",
        ticketFeeCapCents: 1000,
      },
      items: [
        {
          ticketId: "vip",
          quantity: 1,
          pricePerUnit: 10000,
          subtotalAmount: 10000,
          commissionType: "ADD_ON",
        },
      ],
    });

    expect(pricing.platformFeeAmount).toBe(1000);
    expect(pricing.buyerFeeAmount).toBe(0);
    expect(pricing.totalAmount).toBe(10000);
    expect(pricing.organiserPayoutAmount).toBe(9000);
  });

  it("calculates event-center fees in major currency units", () => {
    expect(
      calculateEventCenterPricing({
        subtotalAmount: 10000,
        fees,
        feeMode: "addon",
      }),
    ).toMatchObject({
      subtotalAmount: 10000,
      platformFeeAmount: 1200,
      buyerFeeAmount: 1200,
      totalAmount: 11200,
      organiserPayoutAmount: 10000,
    });
  });

  it("bases affiliate earnings on Munasaba's fee, not the gross sale", () => {
    const grossSale = 10000;
    const platformFee = 1500;
    expect(calculateAffiliateReward(platformFee, 10)).toBe(150);
    expect(calculateAffiliateReward(platformFee, 10)).not.toBe(grossSale * 0.1);
  });
});
