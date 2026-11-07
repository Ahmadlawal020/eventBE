const { test } = require("node:test"), assert = require("node:assert/strict");
const { mergePolicyUpdate } = require("../services/venuePolicyUpdate.service");
const { payoutReadinessError, ownerMeetsPublishingRequirements } = require("../services/eventCenterSettings.service");
const venue = { updatedAt: new Date("2030-01-01"), cancellationPolicy: { allowGuestCancellation: true, noticeHours: 24, maxReschedules: 1, refundDays: 7 } };
test("policy patches retain other sections and require the version the organiser edited", () => {
  const saved = mergePolicyUpdate(venue, { maxReschedules: 3 }, "2030-01-01");
  assert.deepEqual(saved, { ...venue.cancellationPolicy, maxReschedules: 3 });
  for (const expected of [undefined, "2029-12-31", "invalid"]) assert.throws(() => mergePolicyUpdate(venue, { refundDays: 3 }, expected), { status: 409 });
  for (const patch of [null, [], { refunds: 3 }, { maxReschedules: 2, createdBy: "other" }]) assert.throws(() => mergePolicyUpdate(venue, patch, "2030-01-01"), { status: 400 });
});
test("publishing payout requirements match the chosen checkout mode", () => {
  const bankOnly = { isIdentityVerified: true, bankDetails: { accountNumber: "test", bankCode: "test" } };
  const subaccountOnly = { isIdentityVerified: true, vendorAccountCode: "test" };
  const review = { bookingSettings: "REVIEW", basePrice: { currency: "NGN" } }, instant = { bookingSettings: "INSTANT" };
  assert.equal(payoutReadinessError(bankOnly, review), null);
  assert.match(payoutReadinessError(bankOnly, instant), /online payout/);
  assert.equal(payoutReadinessError(subaccountOnly, instant), null);
  assert.match(payoutReadinessError(subaccountOnly, review), /bank account/);
  assert.match(payoutReadinessError(bankOnly, { ...review, basePrice: { currency: "USD" } }), /NGN/);
  const settings = { publishing: { requireIdentityVerification: true, requirePayoutAccount: true } };
  assert.equal(ownerMeetsPublishingRequirements(bankOnly, settings, instant), false);
  assert.equal(ownerMeetsPublishingRequirements(bankOnly, settings, review), true);
});
