const express = require("express");
const router = express.Router();
const {
  getPlatformFees,
} = require("../../controllers/client/platformFees.controller");

router.get("/", getPlatformFees);

module.exports = router;
