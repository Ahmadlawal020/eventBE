const express = require("express");
const router = express.Router();
const verifyJWT = require("../../middleware/verifyJWT");
const {
  getPlatformFees,
} = require("../../controllers/client/platformFees.controller");

router.get("/", verifyJWT, getPlatformFees);

module.exports = router;
