const { rateLimit } = require("express-rate-limit");
const make = (limit, windowMs = 60000, keyGenerator) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  ...(keyGenerator ? { keyGenerator } : {}),
  message: { success: false, message: "Too many attempts. Please wait and try again." },
});
module.exports = {
  auth: make(60), login: make(10, 15 * 60000), otpSend: make(5, 15 * 60000),
  otpVerify: make(20, 15 * 60000), quote: make(60),
  checkout: make(10, 60000, req => String(req.user.id)),
  transfer: make(15, 60000, req => String(req.user.id)),
};
