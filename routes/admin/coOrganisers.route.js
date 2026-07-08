const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const {
  getCoOrganisers,
  getCoOrganiserDetail,
} = require("../../controllers/admin/adminCoOrganisers.controller");

router.get("/", verifyAdmin, getCoOrganisers);
router.get("/:id", verifyAdmin, getCoOrganiserDetail);

module.exports = router;
