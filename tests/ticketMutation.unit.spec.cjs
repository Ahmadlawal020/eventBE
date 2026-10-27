const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateOrderLimits } = require("../services/ticketMutation.service");
test("tier order limits reject fractional, inverted and excessive ranges", () => {
  for (const value of [{ min: 3, max: 2 }, { min: 1.5, max: 2 }, { min: 1, max: 21 }, { min: 0, max: 1 }])
    assert.throws(() => validateOrderLimits(value, 20), /minimum and maximum/);
  assert.deepEqual(validateOrderLimits(undefined, 20), { min: 1, max: 20 });
});
