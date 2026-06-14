const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getKycSubmissions,
  getKycDetails,
  reviewKyc,
} = require("../../controllers/admin/adminKyc.controller");

router.get("/", verifyAdmin, getKycSubmissions);
router.get("/:id", verifyAdmin, getKycDetails);
router.put("/:id/review", verifyAdmin, reviewKyc);

module.exports = router;
