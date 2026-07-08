const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/admin/verifyAdmin");
const { globalSearch } = require("../../controllers/admin/adminSearch.controller");

router.get("/", verifyAdmin, globalSearch);

module.exports = router;
