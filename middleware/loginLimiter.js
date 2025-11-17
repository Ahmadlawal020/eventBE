const rateLimit = require("express-rate-limit");
const { logEvents } = require("./logger");

// Rate limiter for login route
const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_LIMIT_WINDOW_MS) || 60 * 1000, // Default: 1 minute
  max: parseInt(process.env.LOGIN_LIMIT_MAX) || 5, // Default: 5 attempts
  message: {
    message:
      "Too many login attempts from this IP, please try again after a 60 second pause",
  },
  handler: (req, res, next, options) => {
    logEvents(
      `Too Many Requests: ${options.message.message}\t${req.method}\t${req.url}\t${req.headers.origin}\t${req.ip}`,
      "errLog.log"
    );
    res.status(options.statusCode).send(options.message);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = loginLimiter;
