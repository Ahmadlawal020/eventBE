const verifyJWT = require("./verifyJWT");
module.exports = (req, res, next) => {
  if (req.headers.authorization) return verifyJWT(req, res, next);
  next();
};
