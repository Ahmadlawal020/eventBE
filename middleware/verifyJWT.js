// const jwt = require("jsonwebtoken");

// const verifyJWT = (req, res, next) => {
//   const authHeader = req.headers.authorization || req.headers.Authorization;

//   if (!authHeader?.startsWith("Bearer ")) {
//     return res.status(401).json({ success: false, message: "Unauthorized" });
//   }

//   const token = authHeader.split(" ")[1];

//   jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
//     if (err) {
//       console.error("JWT verification error:", err);
//       return res.status(403).json({ success: false, message: "Forbidden" });
//     }

//     req.user = decoded.UserInfo; // { id, email, roles }
//     // req.userId = decoded.UserInfo.id;
//     // req.roles = decoded.UserInfo.roles;

//     next();
//   });
// };

// module.exports = verifyJWT;
// middleware/verifyJWT.js
const jwt = require("jsonwebtoken");

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.error("JWT verification error:", err);

      if (err.name === "TokenExpiredError") {
        return res
          .status(401)
          .json({ success: false, message: "Token expired" });
      }

      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    req.user = decoded.UserInfo;
    next();
  });
};

module.exports = verifyJWT;
