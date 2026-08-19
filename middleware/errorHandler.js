const { logEvents } = require("./logger");

const errorHandler = (err, req, res, next) => {
  logEvents(
    `${err.name}: ${err.message}\t${req.method}\t${req.url}\t${req.headers.origin}`,
    "errLog.log"
  );
  console.log(err.stack);

  const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  res.status(status);

  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Internal Server Error"
      : err.message || "An unexpected error occurred";

  res.json({ success: false, message });
};

module.exports = errorHandler;
