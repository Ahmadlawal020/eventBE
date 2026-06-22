const rateLimit = require("express-rate-limit");
const { logEvents } = require("./logger");

/**
 * Generate a rate limiter with custom options
 *
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Max requests per window
 * @param {string} options.message - Error message
 * @returns {Function} Express middleware
 */
const generateLimiter = ({ windowMs, max, message }) => {
  return rateLimit({
    windowMs,
    max,
    message: { message },
    handler: (req, res, next, options) => {
      logEvents(
        `Too Many Requests: ${message}\t${req.method}\t${req.url}\t${req.ip}`,
        "errLog.log"
      );
      res.status(options.statusCode).send(options.message);
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

module.exports = generateLimiter;
