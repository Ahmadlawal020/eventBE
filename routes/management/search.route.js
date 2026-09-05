const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/management/verifyAdmin");
const { globalSearch } = require("../../controllers/management/search.controller");

router.get("/", verifyAdmin, globalSearch);

module.exports = router;
