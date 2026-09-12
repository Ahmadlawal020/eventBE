const asyncHandler = require("express-async-handler");
const { randomUUID, randomInt } = require("node:crypto");
const SelfieChallenge = require("../../models/client/selfieChallenge.schema");
const IdentityVerification = require("../../models/client/identityVerification.schema");

const createSelfieChallenge = asyncHandler(async (req, res) => {
  const active = await IdentityVerification.exists({
    userId: req.user.id, status: { $in: ["pending", "approved"] },
  });
  if (active) return res.status(409).json({ message: "You already have an active identity verification request." });
  const steps = randomInt(2) === 0 ? ["blink", "turn_left", "turn_right"] : ["turn_right", "blink", "turn_left"];
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await SelfieChallenge.findOneAndUpdate({ userId: req.user.id }, {
    $set: { sessionId, steps, expiresAt, usedAt: null },
  }, { upsert: true, new: true, runValidators: true });
  res.set("Cache-Control", "no-store");
  res.status(201).json({ sessionId, steps, expiresAt });
});
module.exports = { createSelfieChallenge };
